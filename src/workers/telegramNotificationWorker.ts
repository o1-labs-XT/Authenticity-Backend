import PgBoss from 'pg-boss';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import { ChainsRepository } from '../db/repositories/chains.repository.js';
import { TelegramBotService } from '../services/telegram/telegramBot.service.js';
import { MessageFormatterService } from '../services/telegram/messageFormatter.service.js';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';

export interface TelegramNotificationJobData {
  submissionId: string;
  correlationId?: string;
}

export class TelegramNotificationWorker {
  constructor(
    private boss: PgBoss,
    private submissionsRepository: SubmissionsRepository,
    private challengesRepository: ChallengesRepository,
    private chainsRepository: ChainsRepository,
    private telegramBot: TelegramBotService,
    private messageFormatter: MessageFormatterService,
    private telegramChannelId?: string
  ) {}

  async start(): Promise<void> {
    logger.info('Telegram notification worker starting');

    await this.boss.work<TelegramNotificationJobData>(
      'telegram-notification',
      {
        includeMetadata: true,
      },
      async (jobs: PgBoss.JobWithMetadata<TelegramNotificationJobData>[]) => {
        for (const job of jobs) {
          await this.processNotificationJob(job);
        }
      }
    );

    logger.info('Telegram notification worker started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping Telegram notification worker...');
  }

  private async processNotificationJob(
    job: PgBoss.JobWithMetadata<TelegramNotificationJobData>
  ): Promise<void> {
    const { submissionId, correlationId } = job.data;

    await withContext({ jobId: job.id, submissionId, correlationId }, async () => {
      const tracker = new PerformanceTracker('job.telegramNotification');

      try {
        logger.info({ submissionId }, 'Processing Telegram notification job');

        // 1. Fetch submission with challenge and chain details
        const submission = await this.submissionsRepository.findById(submissionId);
        if (!submission) {
          throw new Error(`Submission ${submissionId} not found`);
        }

        const challenge = await this.challengesRepository.findById(submission.challenge_id);
        if (!challenge) {
          throw new Error(`Challenge ${submission.challenge_id} not found`);
        }

        const chain = await this.chainsRepository.findById(submission.chain_id);
        if (!chain) {
          throw new Error(`Chain ${submission.chain_id} not found`);
        }

        // 2. Send to channel (if configured)
        if (this.telegramChannelId) {
          const channelMessage = this.messageFormatter.formatChannelNotification(
            submission,
            challenge.title,
            chain.name
          );

          await this.telegramBot.sendMessageToChannel(
            this.telegramChannelId,
            channelMessage,
            correlationId
          );

          logger.debug({ submissionId, channel: this.telegramChannelId }, 'Sent to channel');
        }

        tracker.end('success');
        logger.info({ submissionId }, 'Telegram notification sent successfully');
      } catch (error) {
        tracker.end('error');
        logger.error({ err: error, submissionId }, 'Telegram notification job failed');
        throw error; // Let pg-boss handle retries
      }
    });
  }
}
