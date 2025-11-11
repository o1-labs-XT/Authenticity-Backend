import PgBoss from 'pg-boss';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { DatabaseConnection } from './db/database.js';
import { ChallengesRepository } from './db/repositories/challenges.repository.js';
import { ContractDeploymentService } from './services/zk/contractDeployment.service.js';
import { ContractDeploymentWorker } from './workers/contractDeploymentWorker.js';

async function main() {
  logger.info('Starting contract deployment worker...');

  let boss: PgBoss | null = null;
  let dbConnection: DatabaseConnection | null = null;

  try {
    // Initialize database
    dbConnection = new DatabaseConnection({
      connectionString: config.databaseUrl,
    });
    await dbConnection.initialize();
    const challengesRepo = new ChallengesRepository(dbConnection.getAdapter());

    // Initialize pg-boss
    boss = new PgBoss(config.databaseUrl);
    await boss.start();
    logger.info('Job queue connected');

    // Initialize deployment service
    const deploymentService = new ContractDeploymentService(config.feePayerPrivateKey);

    // Initialize and start worker
    const worker = new ContractDeploymentWorker(boss, challengesRepo, deploymentService);
    await worker.start();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');
      await worker.stop();
      if (boss) await boss.stop();
      if (dbConnection) await dbConnection.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start worker');
    if (boss) await boss.stop();
    if (dbConnection) await dbConnection.close();
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

main().catch((error) => {
  logger.fatal({ err: error }, 'Fatal error in contract deployment worker');
  process.exit(1);
});
