import { config } from './config/index.js';
import { DatabaseConnection } from './db/database.js';
import { SubmissionsRepository } from './db/repositories/submissions.repository.js';
import { ProofPublishingService } from './services/zk/proofPublishing.service.js';
import { MinaNodeService } from './services/blockchain/minaNode.service.js';
import { ProofPublishingWorker } from './workers/proofPublishingWorker.js';
import PgBoss from 'pg-boss';
import { logger } from './utils/logger.js';

async function startWorker() {
  logger.info('Starting Proof Publishing Worker...');

  let boss: PgBoss | null = null;
  let dbConnection: DatabaseConnection | null = null;

  try {
    // Initialize database
    logger.info('Initializing database connection...');
    dbConnection = new DatabaseConnection({
      connectionString: config.databaseUrl,
    });
    await dbConnection.initialize();
    const submissionsRepository = new SubmissionsRepository(dbConnection.getAdapter());

    // Initialize pg-boss
    logger.info('Initializing pg-boss...');
    boss = new PgBoss(config.databaseUrl);
    await boss.start();

    // Initialize services
    logger.info('Initializing services...');
    const minaNodeService = new MinaNodeService(config.minaNodeEndpoint);

    logger.info('Initializing proof publishing service...');
    const proofPublishingService = new ProofPublishingService(
      config.feePayerPrivateKey,
      config.minaNetwork,
      submissionsRepository,
      minaNodeService
    );

    // Start worker
    const worker = new ProofPublishingWorker(boss, submissionsRepository, proofPublishingService);

    await worker.start();
    logger.info('Proof publishing worker started successfully');

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
    logger.fatal({ err: error }, 'Failed to start proof publishing worker');

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
  logger.fatal({ err: error }, 'Failed to start proof publishing worker');
  process.exit(1);
});
