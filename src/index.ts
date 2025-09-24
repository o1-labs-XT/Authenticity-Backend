import { config } from './config/index.js';
import { createServer } from './api/server.js';
import { DatabaseConnection } from './db/database.js';
import { AuthenticityRepository } from './db/repositories/authenticity.repository.js';
import { ChallengesRepository } from './db/repositories/challenges.repository.js';
import { ImageAuthenticityService } from './services/image/verification.service.js';
import { MinioStorageService } from './services/storage/minio.service.js';
import { JobQueueService } from './services/queue/jobQueue.service.js';
import { UploadHandler } from './handlers/upload.handler.js';
import { StatusHandler } from './handlers/status.handler.js';
import { TokenOwnerHandler } from './handlers/tokenOwner.handler.js';
import { AdminHandler } from './handlers/admin.handler.js';
import { ChallengesHandler } from './handlers/challenges.handler.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('Starting Authenticity Backend...');

  try {
    // Initialize database
    logger.info('Initializing database...');
    const dbConnection = new DatabaseConnection({
      connectionString: config.databaseUrl,
    });
    await dbConnection.initialize();
    const repository = new AuthenticityRepository(dbConnection.getAdapter());
    const challengesRepository = new ChallengesRepository(dbConnection.getAdapter());

    // Initialize services
    logger.info('Initializing services...');
    const verificationService = new ImageAuthenticityService();
    const storageService = new MinioStorageService();
    const jobQueue = new JobQueueService(config.databaseUrl);
    await jobQueue.start();

    // Initialize handlers
    const uploadHandler = new UploadHandler(
      verificationService,
      repository,
      jobQueue,
      storageService
    );
    const statusHandler = new StatusHandler(repository);
    const tokenOwnerHandler = new TokenOwnerHandler(repository);
    const adminHandler = new AdminHandler(jobQueue, repository);
    const challengesHandler = new ChallengesHandler(challengesRepository);

    // Create and start server
    const app = createServer({
      uploadHandler,
      statusHandler,
      tokenOwnerHandler,
      adminHandler,
      challengesHandler,
    });

    const port = config.port;

    const server = app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
      logger.info(`Health check: http://localhost:${port}/health`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(() => {
        logger.info('HTTP server closed');
      });

      // Stop job queue
      await jobQueue.stop();

      // Close database
      await dbConnection.close();

      logger.info('Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught Exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled Rejection');
  process.exit(1);
});

// Start the application
main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start application');
  process.exit(1);
});
