import { config } from './config/index.js';
import { DatabaseConnection } from './db/database.js';
import { SubmissionsRepository } from './db/repositories/submissions.repository.js';
import { ChallengesRepository } from './db/repositories/challenges.repository.js';
import { ChainsRepository } from './db/repositories/chains.repository.js';
import { TelegramBotService } from './services/telegram/telegramBot.service.js';
import { MessageFormatterService } from './services/telegram/messageFormatter.service.js';
import { TelegramNotificationWorker } from './workers/telegramNotificationWorker.js';
import PgBoss from 'pg-boss';
import { logger } from './utils/logger.js';

async function startTelegramWorker() {
  logger.info('Starting Telegram Notification Worker...');

  let boss: PgBoss | null = null;
  let dbConnection: DatabaseConnection | null = null;

  try {
    // Check if Telegram notifications are enabled
    if (!config.telegramEnabled) {
      logger.info('Telegram notifications are disabled via configuration. Exiting.');
      return;
    }

    // Validate Telegram configuration
    if (!config.telegramBotToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is required when TELEGRAM_ENABLED=true');
    }

    // Initialize database
    logger.info('Initializing database connection...');
    dbConnection = new DatabaseConnection({
      connectionString: config.databaseUrl,
    });
    await dbConnection.initialize();

    const submissionsRepo = new SubmissionsRepository(dbConnection.getAdapter());
    const challengesRepo = new ChallengesRepository(dbConnection.getAdapter());
    const chainsRepo = new ChainsRepository(dbConnection.getAdapter());

    // Initialize Telegram services
    logger.info('Initializing Telegram bot service...');
    const telegramBot = new TelegramBotService(config.telegramBotToken);
    const messageFormatter = new MessageFormatterService(config.frontendUrl);

    // Initialize pg-boss
    logger.info('Initializing pg-boss...');
    boss = new PgBoss(config.databaseUrl);
    await boss.start();

    // Start Telegram notification worker
    logger.info('Initializing Telegram notification worker...');
    const worker = new TelegramNotificationWorker(
      boss,
      submissionsRepo,
      challengesRepo,
      chainsRepo,
      telegramBot,
      messageFormatter,
      config.telegramChannelId
    );

    await worker.start();
    logger.info('Telegram notification worker started successfully');

    if (config.telegramChannelId) {
      logger.info({ channelId: config.telegramChannelId }, 'Sending to Telegram channel');
    }

    // Shutdown
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

      logger.info('Telegram worker shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start Telegram worker');

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

// Start the Telegram worker
startTelegramWorker().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start Telegram worker');
  process.exit(1);
});
