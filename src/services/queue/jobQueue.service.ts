import PgBoss from 'pg-boss';
import { logger } from '../../utils/logger.js';

export interface ProofGenerationJobData {
  sha256Hash: string;
  signature: string;
  storageKey: string; // minio storage key
  tokenOwnerAddress: string;
  tokenOwnerPrivateKey: string;
  uploadedAt: Date;
  priority?: number;
  correlationId?: string;
}

export interface BlockchainMonitoringJobData {
  scheduledAt: Date;
  lookbackBlocks?: number;
}

export class JobQueueService {
  private boss: PgBoss;

  constructor(connectionString: string) {
    this.boss = new PgBoss(connectionString);
  }

  async start(): Promise<void> {
    await this.boss.start();

    // Create queues if they don't exist
    await this.boss.createQueue('proof-generation');
    await this.boss.createQueue('blockchain-monitoring');
    logger.info('Job queue started');
  }

  async stop(): Promise<void> {
    await this.boss.stop();
    logger.info('Job queue stopped');
  }

  async enqueueProofGeneration(data: ProofGenerationJobData): Promise<string> {
    try {
      const jobId = await this.boss.send('proof-generation', data, {
        retryLimit: 3,
        retryDelay: 60,
        retryBackoff: true,
        singletonKey: data.sha256Hash,
      });

      logger.debug({ jobId, sha256Hash: data.sha256Hash }, 'Job enqueued');
      return jobId || '';
    } catch (error) {
      logger.error({ err: error }, 'Failed to enqueue job');
      throw error;
    }
  }

  async scheduleMonitoringJob(): Promise<void> {
    try {
      // Schedule recurring job every 5 minutes
      await this.boss.schedule(
        'blockchain-monitoring',
        '*/5 * * * *',
        {
          scheduledAt: new Date(),
          lookbackBlocks: 100,
        },
        {
          singletonKey: 'blockchain-monitoring-singleton',
        }
      );

      logger.info('Blockchain monitoring job scheduled (every 5 minutes)');
    } catch (error) {
      logger.error({ err: error }, 'Failed to schedule monitoring job');
      throw error;
    }
  }
}
