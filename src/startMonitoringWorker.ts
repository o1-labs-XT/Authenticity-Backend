import { config } from './config/index.js';
import { DatabaseConnection } from './db/database.js';
import { SubmissionsRepository } from './db/repositories/submissions.repository.js';
import { ArchiveNodeService } from './services/blockchain/archiveNode.service.js';
import { MinaNodeService } from './services/blockchain/minaNode.service.js';
import { BlockchainMonitoringService } from './services/blockchain/monitoring.service.js';
import { JobQueueService } from './services/queue/jobQueue.service.js';
import { BlockchainMonitorWorker } from './workers/blockchainMonitorWorker.js';
import PgBoss from 'pg-boss';
import { logger } from './utils/logger.js';

async function startMonitoringWorker() {
  logger.info('Starting Blockchain Monitoring Worker...');

  let boss: PgBoss | null = null;
  let dbConnection: DatabaseConnection | null = null;
  let jobQueueService: JobQueueService | null = null;

  try {
    // Check if monitoring is enabled
    if (!config.monitoringEnabled) {
      logger.info('Blockchain monitoring is disabled via configuration. Exiting.');
      return;
    }

    // Initialize database
    logger.info('Initializing database connection...');
    dbConnection = new DatabaseConnection({
      connectionString: config.databaseUrl,
    });
    await dbConnection.initialize();
    const repository = new SubmissionsRepository(dbConnection.getAdapter());

    // Initialize pg-boss
    logger.info('Initializing pg-boss...');
    boss = new PgBoss(config.databaseUrl);
    await boss.start();

    // Initialize job queue service
    logger.info('Initializing job queue service...');
    jobQueueService = new JobQueueService(config.databaseUrl);
    await jobQueueService.start();

    // Initialize blockchain monitoring services
    logger.info('Initializing blockchain monitoring services...');
    const archiveNodeService = new ArchiveNodeService(config.archiveNodeEndpoint);
    const minaNodeService = new MinaNodeService(config.minaNodeEndpoint);
    const monitoringService = new BlockchainMonitoringService();

    // Start monitoring worker
    // For now, pass empty string as zkApp address (monitoring disabled for per-challenge contracts)
    const worker = new BlockchainMonitorWorker(
      boss,
      repository,
      archiveNodeService,
      minaNodeService,
      monitoringService,
      '' // TODO: update monitoring to handle multiple zkApp addresses
    );

    await worker.start();
    logger.info('Monitoring worker started successfully');

    // Schedule blockchain monitoring job
    logger.info('Scheduling blockchain monitoring job...');
    await jobQueueService.scheduleMonitoringJob();
    logger.info('Blockchain monitoring job scheduled (every 5 minutes)');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      if (worker) {
        await worker.stop();
      }

      if (jobQueueService) {
        await jobQueueService.stop();
        logger.info('Job queue service stopped');
      }

      if (boss) {
        await boss.stop();
        logger.info('Job queue stopped');
      }

      if (dbConnection) {
        await dbConnection.close();
        logger.info('Database connection closed');
      }

      logger.info('Monitoring worker shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start monitoring worker');

    // Clean up on error
    if (jobQueueService) {
      await jobQueueService.stop();
    }
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

// Start the monitoring worker
startMonitoringWorker().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start monitoring worker');
  process.exit(1);
});
