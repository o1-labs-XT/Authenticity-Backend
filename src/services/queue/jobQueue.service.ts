import PgBoss from 'pg-boss';

export interface ProofGenerationJobData {
  sha256Hash: string;
  signature: string;
  publicKey: string;
  imagePath: string;
  tokenOwnerAddress: string;
  tokenOwnerPrivateKey: string;
  uploadedAt: Date;
  priority?: number;
}

export class JobQueueService {
  private boss: PgBoss;
  
  constructor(connectionString: string) {
    this.boss = new PgBoss(connectionString);
  }

  async start(): Promise<void> {
    await this.boss.start();
    
    // Create queue if it doesn't exist
    await this.boss.createQueue('proof-generation');
    console.log('✅ Queue created/verified: proof-generation');
    
    console.log('🚀 Job queue started');
  }

  async stop(): Promise<void> {
    await this.boss.stop();
    console.log('🛑 Job queue stopped');
  }

  async enqueueProofGeneration(data: ProofGenerationJobData): Promise<string> {
    try {
      const jobId = await this.boss.send(
        'proof-generation',
        data,
        {
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
          singletonKey: data.sha256Hash,
        }
      );

      console.log(`📋 Enqueued proof generation job ${jobId} for hash ${data.sha256Hash}`);
      return jobId || '';
    } catch (error) {
      console.error('❌ Failed to enqueue job:', error);
      throw error;
    }
  }

  async getJobById(jobId: string): Promise<any> {
    // pg-boss getJobById requires queue name as well
    return await this.boss.getJobById('proof-generation', jobId);
  }

  async getQueueStats(): Promise<any> {
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
      console.error('Failed to get queue stats:', error);
      throw error;
    }
  }

  async retryJob(jobId: string): Promise<void> {
    try {
      await this.boss.retry('proof-generation', jobId);
      console.log(`🔄 Retried job ${jobId}`);
    } catch (error) {
      console.error('Failed to retry job:', error);
      throw error;
    }
  }
}