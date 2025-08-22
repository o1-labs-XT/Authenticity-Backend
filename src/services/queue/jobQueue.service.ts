import PgBoss from 'pg-boss';
import { config } from '../../config/index.js';

export interface ProofGenerationJobData {
  sha256Hash: string;
  signature: string;
  publicKey: string;
  imagePath: string;
  tokenOwnerAddress: string;
  uploadedAt: Date;
  priority?: number;
}

export interface JobOptions {
  priority?: number;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInHours?: number;
  singletonKey?: string;
  singletonHours?: number;
}

export class JobQueueService {
  private boss: PgBoss;
  
  constructor(connectionString: string) {
    this.boss = new PgBoss({
      connectionString,
      // Archive completed jobs for 30 days for audit trail
      archiveCompletedAfterSeconds: 60 * 60 * 24 * 30, // 30 days
      // Archive failed jobs for 90 days for debugging
      archiveFailedAfterSeconds: 60 * 60 * 24 * 90, // 90 days
      // Keep archived jobs for historical analysis
      deleteAfterArchive: false,
      // Default retry configuration
      retryLimit: 3,
      retryDelay: 60, // 1 minute
      retryBackoff: true, // Exponential backoff
      // Jobs expire after 24 hours if not processed
      expireInHours: 24,
      // Monitor state every 30 seconds
      monitorStateIntervalSeconds: 30,
      // Run maintenance every 2 minutes
      maintenanceIntervalSeconds: 120,
      // Schema for pg-boss tables
      schema: 'pgboss',
    });
  }

  async start(): Promise<void> {
    await this.boss.start();
    
    // Set up monitoring events
    this.boss.on('error', (error) => {
      console.error('pg-boss error:', error);
    });

    this.boss.on('monitor-states', (states) => {
      console.log('📊 Queue state:', {
        created: states.created,
        retry: states.retry,
        active: states.active,
        completed: states.completed,
        expired: states.expired,
        cancelled: states.cancelled,
        failed: states.failed,
      });
    });

    console.log('🚀 Job queue started');
  }

  async stop(): Promise<void> {
    await this.boss.stop();
    console.log('🛑 Job queue stopped');
  }

  async enqueueProofGeneration(data: ProofGenerationJobData): Promise<string> {
    const jobId = await this.boss.send(
      'proof-generation',
      data,
      {
        retryLimit: 3,
        retryDelay: 60,
        retryBackoff: true,
        priority: data.priority || 0,
        // Prevent duplicate jobs for the same image hash
        singletonKey: data.sha256Hash,
        // Singleton window of 24 hours
        singletonHours: 24,
        // Custom expire time (1 hour for proof generation)
        expireInHours: 1,
      }
    );

    console.log(`📋 Enqueued proof generation job ${jobId} for hash ${data.sha256Hash}`);
    return jobId;
  }

  async getJobById(jobId: string): Promise<PgBoss.Job | null> {
    return await this.boss.getJobById(jobId);
  }

  async getQueueStats(queue: string = 'proof-generation'): Promise<{
    pending: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [pending, active, completed, failed] = await Promise.all([
      this.boss.getQueueSize(queue),
      this.boss.getQueueSize(queue, { state: 'active' }),
      this.boss.getQueueSize(queue, { state: 'completed' }),
      this.boss.getQueueSize(queue, { state: 'failed' }),
    ]);

    return { pending, active, completed, failed };
  }

  async retryJob(jobId: string): Promise<void> {
    // pg-boss doesn't have a direct retry method, but we can achieve it
    // by cancelling and re-enqueuing
    const job = await this.boss.getJobById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.state === 'completed') {
      throw new Error(`Job ${jobId} is already completed`);
    }

    // Cancel the current job
    await this.boss.cancel(jobId);

    // Re-enqueue with the same data
    await this.enqueueProofGeneration(job.data as ProofGenerationJobData);
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.boss.cancel(jobId);
    console.log(`❌ Cancelled job ${jobId}`);
  }

  // Admin functions for monitoring

  async getFailedJobs(limit: number = 10): Promise<PgBoss.Job[]> {
    return await this.boss.fetch('proof-generation', undefined, {
      includeMetadata: true,
      limit,
    });
  }

  async getActiveJobs(): Promise<PgBoss.Job[]> {
    // Get all active jobs
    const jobs = await this.boss.fetch('proof-generation', undefined, {
      includeMetadata: true,
    });
    return jobs.filter(job => job.state === 'active');
  }

  async clearFailedJobs(): Promise<void> {
    // Archive all failed jobs immediately
    await this.boss.archive();
    console.log('🧹 Cleared failed jobs');
  }

  // Utility method to check if queue is healthy
  async isHealthy(): Promise<boolean> {
    try {
      // Try to get queue size as a health check
      await this.boss.getQueueSize('proof-generation');
      return true;
    } catch (error) {
      console.error('Queue health check failed:', error);
      return false;
    }
  }
}