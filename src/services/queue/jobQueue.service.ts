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
}