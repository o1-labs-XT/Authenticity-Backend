import { config } from './config/index.js';
import { DatabaseConnection } from './db/database.js';
import { AuthenticityRepository } from './db/repositories/authenticity.repository.js';
import { ImageAuthenticityService } from './services/image/verification.service.js';
import { MinioStorageService } from './services/storage/minio.service.js';
import { ProofGenerationService } from './services/zk/proofGeneration.service.js';
import { ProofPublishingService } from './services/zk/proofPublishing.service.js';
import { ProofGenerationWorker } from './workers/proofGenerationWorker.js';
import PgBoss from 'pg-boss';
import { logger } from './utils/logger.js';

async function startWorker() {
  logger.info('Starting Authenticity Worker...');

  let boss: PgBoss | null = null;
  let dbConnection: DatabaseConnection | null = null;

  try {
    // Initialize database
    logger.info('Initializing database connection...');
    dbConnection = new DatabaseConnection({
      connectionString: config.databaseUrl,
    });
    await dbConnection.initialize();
    const repository = new AuthenticityRepository(dbConnection.getAdapter());

    // Initialize pg-boss
    logger.info('Initializing pg-boss...');
    boss = new PgBoss(config.databaseUrl);
    await boss.start();

    // Initialize services
    logger.info('Initializing services...');
    const verificationService = new ImageAuthenticityService();
    const storageService = new MinioStorageService();

    logger.info('Initializing proof generation service...');
    const proofGenerationService = new ProofGenerationService();

    logger.info('Initializing proof publishing service...');
    const proofPublishingService = new ProofPublishingService(
      config.zkappAddress,
      config.feePayerPrivateKey,
      config.minaNetwork,
      repository
    );

    // Start worker
    const worker = new ProofGenerationWorker(
      boss,
      repository,
      verificationService,
      proofGenerationService,
      proofPublishingService,
      storageService
    );

    await worker.start();
    logger.info('Worker started successfully');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      if (worker) {
        await worker.stop();
      }

      if (boss) {
        await boss.stop();
        logger.info('Job queue stopped');
      }

      if (dbConnection) {
        await dbConnection.close();
        logger.info('Database connection closed');
      }

      logger.info('Worker shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start worker');

    // Clean up on error
    if (boss) {
      await boss.stop();
    }
    if (dbConnection) {
      await dbConnection.close();
    }

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

// Start the worker
startWorker().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start worker');
  process.exit(1);
});
