import PgBoss from 'pg-boss';
import { logger } from '../../utils/logger.js';

export interface ProofGenerationJobData {
  sha256Hash: string;
  signature: string;
  publicKey: string;
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

  async getJobById(jobId: string): Promise<PgBoss.JobWithMetadata<ProofGenerationJobData> | null> {
    // pg-boss getJobById requires queue name as well
    return await this.boss.getJobById('proof-generation', jobId);
  }

  async getQueueStats(): Promise<{
    pending: number;
    active: number;
    completed: number;
    failed: number;
    total: number;
  }> {
    try {
      // In pg-boss v10, getQueueSize returns count of jobs in created state by default
      const pending = await this.boss.getQueueSize('proof-generation');
      const failed = await this.boss.getQueueSize('proof-generation', { before: 'failed' });
      const active = await this.boss.getQueueSize('proof-generation', { before: 'active' });
      const completed = await this.boss.getQueueSize('proof-generation', { before: 'completed' });

      return {
        pending,
        active,
        completed,
        failed,
        total: pending + active + completed + failed,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get queue stats');
      throw error;
    }
  }

  async retryJob(jobId: string): Promise<void> {
    try {
      await this.boss.retry('proof-generation', jobId);
      logger.info({ jobId }, 'Job retried successfully');
    } catch (error) {
      logger.error({ err: error, jobId }, 'Failed to retry job');
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

  async enqueueMonitoringJob(data: BlockchainMonitoringJobData): Promise<string> {
    try {
      const jobId = await this.boss.send('blockchain-monitoring', data, {
        singletonKey: 'blockchain-monitoring-manual',
      });

      logger.debug({ jobId }, 'Monitoring job enqueued');
      return jobId || '';
    } catch (error) {
      logger.error({ err: error }, 'Failed to enqueue monitoring job');
      throw error;
    }
  }
}
