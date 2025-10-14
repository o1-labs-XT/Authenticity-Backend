import { config } from './config/index.js';
import { createServer } from './api/server.js';
import { DatabaseConnection } from './db/database.js';
import { ChallengesRepository } from './db/repositories/challenges.repository.js';
import { ChainsRepository } from './db/repositories/chains.repository.js';
import { UsersRepository } from './db/repositories/users.repository.js';
import { SubmissionsRepository } from './db/repositories/submissions.repository.js';
import { ImageAuthenticityService } from './services/image/verification.service.js';
import { MinioStorageService } from './services/storage/minio.service.js';
import { JobQueueService } from './services/queue/jobQueue.service.js';
import { StatusHandler } from './handlers/status.handler.js';
import { TokenOwnerHandler } from './handlers/tokenOwner.handler.js';
import { AdminHandler } from './handlers/admin.handler.js';
import { ChallengesHandler } from './handlers/challenges.handler.js';
import { ChainsHandler } from './handlers/chains.handler.js';
import { UsersHandler } from './handlers/users.handler.js';
import { SubmissionsHandler } from './handlers/submissions.handler.js';
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
    const challengesRepository = new ChallengesRepository(dbConnection.getAdapter());
    const chainsRepository = new ChainsRepository(dbConnection.getAdapter());
    const usersRepository = new UsersRepository(dbConnection.getAdapter());
    const submissionsRepository = new SubmissionsRepository(dbConnection.getAdapter());

    // Initialize services
    logger.info('Initializing services...');
    const verificationService = new ImageAuthenticityService();
    const storageService = new MinioStorageService();
    const jobQueue = new JobQueueService(config.databaseUrl);
    await jobQueue.start();

    // Initialize handlers
    const statusHandler = new StatusHandler(submissionsRepository);
    const tokenOwnerHandler = new TokenOwnerHandler(submissionsRepository);
    const adminHandler = new AdminHandler(jobQueue, submissionsRepository);
    const challengesHandler = new ChallengesHandler(challengesRepository);
    const chainsHandler = new ChainsHandler(chainsRepository);
    const usersHandler = new UsersHandler(usersRepository);
    const submissionsHandler = new SubmissionsHandler(
      submissionsRepository,
      usersRepository,
      chainsRepository,
      challengesRepository,
      verificationService,
      jobQueue,
      storageService
    );

    // Create and start server
    const app = createServer({
      statusHandler,
      tokenOwnerHandler,
      adminHandler,
      challengesHandler,
      chainsHandler,
      usersHandler,
      submissionsHandler,
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
