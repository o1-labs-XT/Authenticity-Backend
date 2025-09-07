import PgBoss from 'pg-boss';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { ImageAuthenticityService } from '../services/image/verification.service.js';
import { ProofGenerationService } from '../services/zk/proofGeneration.service.js';
import { ProofPublishingService } from '../services/zk/proofPublishing.service.js';
import { ProofGenerationJobData } from '../services/queue/jobQueue.service.js';
import fs from 'fs/promises';

export class ProofGenerationWorker {
  private workerName: string;

  constructor(
    private boss: PgBoss,
    private repository: AuthenticityRepository,
    private imageAuthenticityService: ImageAuthenticityService,
    private proofGenerationService: ProofGenerationService,
    private proofPublishingService: ProofPublishingService
  ) {
    this.workerName = `worker-${process.pid}-${Date.now()}`;
  }

  async start(): Promise<void> {
    await this.boss.work<ProofGenerationJobData>(
      'proof-generation',
      async (jobs) => {
        // Process jobs one at a time (batch size is 1)
        for (const job of jobs) {
          console.log(`👷 Worker ${this.workerName} processing job ${job.id} for hash ${job.data.sha256Hash}`);
          
          const { 
            sha256Hash, 
            signature, 
            publicKey, 
            imagePath, 
            tokenOwnerAddress,
            tokenOwnerPrivateKey 
          } = job.data;
          
          try {
            // Update status to processing
            await this.repository.updateRecord(sha256Hash, {
              status: 'processing',
              processing_started_at: new Date().toISOString(),
              retry_count: (job as any).retryCount || 0,
            });

            // Step 1: Verify and prepare image
            console.log(`🔍 Verifying and preparing image for ${sha256Hash}`);
            const { isValid, verificationInputs, error } = this.imageAuthenticityService.verifyAndPrepareImage(
              imagePath,
              signature,
              publicKey
            );

            if (!isValid || !verificationInputs) {
              throw new Error(`Image verification failed: ${error || 'Unknown error'}`);
            }

            // Step 2: Generate proof
            console.log(`🔐 Generating proof for ${sha256Hash}`);
            const { proof, publicInputs } = await this.proofGenerationService.generateProof(
              sha256Hash,
              publicKey,
              signature,
              verificationInputs,
              imagePath
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
            try {
              await fs.unlink(imagePath);
              console.log(`🧹 Cleaned up temp file for ${sha256Hash}`);
            } catch (cleanupError) {
              console.error(`Failed to clean up temp file ${imagePath}:`, cleanupError);
            }

            console.log(`✅ Proof completed for ${sha256Hash}: ${transactionId}`);

          } catch (error: any) {
            console.error(`❌ Proof generation failed for ${sha256Hash}:`, error);
            // Check if this is the final retry
            const retryCount = (job as any).retryCount || 0;
            const retryLimit = 3; // Default retry limit
            const isLastRetry = retryCount >= retryLimit - 1;
            
            // Update failure status
            await this.repository.updateRecord(sha256Hash, {
              status: isLastRetry ? 'failed' : 'pending',
              failed_at: isLastRetry ? new Date().toISOString() : null,
              failure_reason: error.message || 'Unknown error',
              retry_count: retryCount + 1,
            });

            // Clean up temp file on final failure
            if (isLastRetry) {
              try {
                await fs.unlink(imagePath);
                console.log(`🧹 Cleaned up temp file after final failure for ${sha256Hash}`);
              } catch (cleanupError) {
                console.error(`Failed to clean up temp file ${imagePath}:`, cleanupError);
              }
            }

            // Re-throw error to trigger pg-boss retry
            throw error;
          }
        }
      }
    );

    console.log(`👷 Proof generation worker ${this.workerName} started`);
  }

  async stop(): Promise<void> {
    // pg-boss handles stopping workers gracefully
    console.log(`👷 Stopping worker ${this.workerName}...`);
  }
}
