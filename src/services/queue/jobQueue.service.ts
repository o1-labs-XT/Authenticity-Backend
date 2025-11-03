import PgBoss from 'pg-boss';
import { logger } from '../../utils/logger.js';

export interface ProofGenerationJobData {
  sha256Hash: string;
  signature: string;
  storageKey: string; // minio storage key
  tokenOwnerAddress: string;
  tokenOwnerPrivateKey: string;
  zkAppAddress: string; // NEW: zkApp address for this proof
  uploadedAt: Date;
  priority?: number;
  correlationId?: string;
}

export interface BlockchainMonitoringJobData {
  scheduledAt: Date;
  lookbackBlocks?: number;
}

export interface ContractDeploymentJobData {
  challengeId: string;
  correlationId?: string;
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
    await this.boss.createQueue('contract-deployment');
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

  async enqueueContractDeployment(data: ContractDeploymentJobData): Promise<string> {
    try {
      const jobId = await this.boss.send('contract-deployment', data, {
        retryLimit: 3, // 3 attempts total
        retryDelay: 120, // 2 minutes between retries
        retryBackoff: true, // Exponential backoff (2min, 4min, 8min)
        singletonKey: data.challengeId, // Prevent duplicate deployment jobs
      });

      logger.info({ jobId, challengeId: data.challengeId }, 'Contract deployment job enqueued');
      return jobId || '';
    } catch (error) {
      logger.error(
        { err: error, challengeId: data.challengeId },
        'Failed to enqueue deployment job'
      );
      throw error;
    }
  }
}
