import PgBoss from 'pg-boss';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { VerificationService } from '../services/image/verification.service.js';
import { ProofGenerationService } from '../services/zk/proofGeneration.service.js';
import { ProofPublishingService } from '../services/zk/proofPublishing.service.js';
import { ProofGenerationJob, ProofGenerationJobData } from '../services/queue/jobQueue.service.js';
import { config } from '../config/index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
export class ProofGenerationWorker {
  private workerName: string;
  private statusInterval?: NodeJS.Timeout;

  constructor(
    private boss: PgBoss,
    private repository: AuthenticityRepository,
    private verificationService: VerificationService,
    private proofGenerationService: ProofGenerationService,
    private proofPublishingService: ProofPublishingService
  ) {
    this.workerName = `worker-${process.pid}-${Date.now()}`;
  }

  async start(): Promise<void> {
    const numWorkers = config.numWorkers;
    console.log(`🔧 Starting worker with ${numWorkers} concurrent job processing`);

    // Start single worker handler that processes jobs with specified concurrency
    const workerId = await this.boss.work<ProofGenerationJobData>(
      'proof-generation',
      { 
        batchSize: 1,
        pollingIntervalSeconds: 2
      },
      async (jobs) => {
        // Process single job (batchSize is 1)
        const job = jobs[0] as ProofGenerationJob;
        const workerInstance = `${this.workerName}-${Math.floor(Math.random() * 1000)}`;
        console.log(
          `👷 Worker ${workerInstance} processing job ${job.id} for hash ${job.data.sha256Hash}`
        );

        const { sha256Hash, signature, publicKey, tokenOwnerPrivateKey } = job.data;
        let tempImagePath: string | null = null;

        try {
          // Update status to processing
          await this.repository.updateRecord(sha256Hash, {
            status: 'processing',
            processing_started_at: new Date().toISOString(),
            retry_count: job.retryCount || 0,
          });

          // Fetch image data from database
          console.log(`📥 Fetching image data from database for ${sha256Hash}`);
          const record = await this.repository.getRecordByHash(sha256Hash);
          if (!record || !record.image_data) {
            throw new Error(`No image data found for hash ${sha256Hash}`);
          }

          // Create temporary file for existing functions that need file paths
          const tempDir = os.tmpdir();
          const tempFileName = `image-${sha256Hash}-${Date.now()}.tmp`;
          tempImagePath = path.join(tempDir, tempFileName);
          
          await fs.writeFile(tempImagePath, record.image_data);
          console.log(`📝 Created temporary file for processing: ${tempImagePath}`);

          // Step 1: Prepare verification data
          console.log(`🔍 Preparing verification for ${sha256Hash}`);
          const verificationInputs = this.verificationService.prepareForVerification(tempImagePath);

          // Step 2: Generate proof
          console.log(`🔐 Generating proof for ${sha256Hash}`);
          const { proof, publicInputs } = await this.proofGenerationService.generateProof(
            sha256Hash,
            publicKey,
            signature,
            verificationInputs,
            tempImagePath
          );

          // Step 3: Publish to blockchain
          console.log(`📡 Publishing proof for ${sha256Hash}`);
          const transactionId = await this.proofPublishingService.publishProof(
            sha256Hash,
            proof,
            publicInputs,
            tokenOwnerPrivateKey
          );

          // Step 4: Update database with success
          await this.repository.updateRecord(sha256Hash, {
            status: 'verified',
            transaction_id: transactionId,
            verified_at: new Date().toISOString(),
          });

          // Clean up temp file
          if (tempImagePath) {
            try {
              await fs.unlink(tempImagePath);
              console.log(`🧹 Cleaned up temp file for ${sha256Hash}`);
            } catch (cleanupError) {
              console.error(`Failed to clean up temp file ${tempImagePath}:`, cleanupError);
            }
          }

          console.log(`✅ Proof completed for ${sha256Hash}: ${transactionId}`);
        } catch (error: any) {
          console.error(`❌ Proof generation failed for ${sha256Hash}:`, error);

          // Check if this is the final retry
          const retryCount = job.retryCount || 0;
          const retryLimit = 3; // Default retry limit
          const isLastRetry = retryCount >= retryLimit - 1;

          // Update failure status
          await this.repository.updateRecord(sha256Hash, {
            status: isLastRetry ? 'failed' : 'pending',
            failed_at: isLastRetry ? new Date().toISOString() : null,
            failure_reason: error.message || 'Unknown error',
            retry_count: retryCount + 1,
          });

          // Clean up temp file on final failure or always clean up temp files
          if (tempImagePath) {
            try {
              await fs.unlink(tempImagePath);
              console.log(`🧹 Cleaned up temp file after failure for ${sha256Hash}`);
            } catch (cleanupError) {
              console.error(`Failed to clean up temp file ${tempImagePath}:`, cleanupError);
            }
          }

          // Re-throw error to trigger pg-boss retry
          throw error;
        }
      }
    );

    console.log(`✅ Worker started successfully with ID: ${workerId}`);
    console.log(`👀 Worker is now polling for jobs every 2 seconds with ${numWorkers} concurrent jobs...`);

    // Start periodic status logging
    this.statusInterval = setInterval(async () => {
      try {
        const stats = await this.boss.getQueueSize('proof-generation');
        console.log(`🔍 Worker status check - Queue size: ${stats} jobs pending`);
      } catch (error) {
        console.error('Failed to get queue stats:', error);
      }
    }, 30000); // Log every 30 seconds
  }

  async stop(): Promise<void> {
    // Clear status interval
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
    }
    
    // pg-boss handles stopping workers gracefully
    console.log(`👷 Stopping worker ${this.workerName}...`);
  }
}
