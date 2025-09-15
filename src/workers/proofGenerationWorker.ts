import PgBoss from 'pg-boss';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { ImageAuthenticityService } from '../services/image/verification.service.js';
import { ProofGenerationService } from '../services/zk/proofGeneration.service.js';
import { ProofPublishingService } from '../services/zk/proofPublishing.service.js';
import { ProofGenerationJobData } from '../services/queue/jobQueue.service.js';
import fs from 'fs/promises';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';

export class ProofGenerationWorker {
  constructor(
    private boss: PgBoss,
    private repository: AuthenticityRepository,
    private imageAuthenticityService: ImageAuthenticityService,
    private proofGenerationService: ProofGenerationService,
    private proofPublishingService: ProofPublishingService
  ) {}

  async start(): Promise<void> {
    await this.boss.work<ProofGenerationJobData>('proof-generation', async (jobs) => {
      // Process jobs one at a time (batch size is 1)
      for (const job of jobs) {
        // Run entire job with logging qcontext
        await withContext(
          {
            jobId: job.id,
            sha256Hash: job.data.sha256Hash,
            correlationId: job.data.correlationId,
            attempt: (job as PgBoss.JobWithMetadata<ProofGenerationJobData>).retryCount || 0,
          },
          async () => {
            const jobTracker = new PerformanceTracker('job.proofGeneration', {
              sha256Hash: job.data.sha256Hash,
            });

            const {
              sha256Hash,
              signature,
              publicKey,
              imagePath,
              tokenOwnerAddress: _tokenOwnerAddress,
              tokenOwnerPrivateKey,
            } = job.data;

            logger.info('Starting proof generation job');

            try {
              // Update status to processing
              await this.repository.updateRecord(sha256Hash, {
                status: 'processing',
                processing_started_at: new Date().toISOString(),
                retry_count:
                  (job as PgBoss.JobWithMetadata<ProofGenerationJobData>).retryCount || 0,
              });

              // Step 1: Verify and prepare image
              logger.info('Verifying and preparing image');
              const verifyTracker = new PerformanceTracker('job.verifyImage');
              const { isValid, verificationInputs, error } =
                this.imageAuthenticityService.verifyAndPrepareImage(
                  imagePath,
                  signature,
                  publicKey
                );
              verifyTracker.end(isValid ? 'success' : 'error');

              if (!isValid || !verificationInputs) {
                throw new Error(`Image verification failed: ${error || 'Unknown error'}`);
              }

              // Step 2: Generate proof
              logger.info('Generating zero-knowledge proof');
              const proofTracker = new PerformanceTracker('job.generateProof');
              const { proof, publicInputs } = await this.proofGenerationService.generateProof(
                sha256Hash,
                publicKey,
                signature,
                verificationInputs,
                imagePath
              );
              proofTracker.end('success');

              // Step 3: Publish to blockchain
              logger.info('Publishing proof to Mina blockchain');
              const publishTracker = new PerformanceTracker('job.publishProof');
              const transactionId = await this.proofPublishingService.publishProof(
                sha256Hash,
                proof,
                publicInputs,
                tokenOwnerPrivateKey
              );
              publishTracker.end('success', { transactionId });

              // Step 4: Update database with success
              await this.repository.updateRecord(sha256Hash, {
                status: 'verified',
                transaction_id: transactionId,
                verified_at: new Date().toISOString(),
              });

              // Clean up temp file
              try {
                await fs.unlink(imagePath);
                logger.debug('Cleaned up temporary file');
              } catch (cleanupError) {
                logger.warn({ err: cleanupError }, 'Failed to clean up temporary file');
              }

              jobTracker.end('success', { transactionId });
              logger.info({ transactionId }, 'Proof generation completed successfully');
            } catch (error) {
              const retryCount =
                (job as PgBoss.JobWithMetadata<ProofGenerationJobData>).retryCount || 0;
              const retryLimit = 3; // Default retry limit
              const isLastRetry = retryCount >= retryLimit - 1;

              logger.error(
                {
                  err: error,
                  isLastRetry,
                },
                'Proof generation failed'
              );

              // Update failure status
              await this.repository.updateRecord(sha256Hash, {
                status: isLastRetry ? 'failed' : 'pending',
                failed_at: isLastRetry ? new Date().toISOString() : null,
                failure_reason: error instanceof Error ? error.message : 'Unknown error',
                retry_count: retryCount + 1,
              });

              // Clean up temp file on final failure
              if (isLastRetry) {
                try {
                  await fs.unlink(imagePath);
                  logger.debug('Cleaned up temp file after final failure');
                } catch (cleanupError) {
                  logger.warn({ err: cleanupError }, 'Failed to clean up temp file after failure');
                }
              }

              // Re-throw error to trigger pg-boss retry
              throw error;
            }
          }
        );
      }
    });

    logger.info('Proof generation worker started');
  }

  async stop(): Promise<void> {
    // pg-boss handles stopping workers gracefully
    logger.info('Stopping worker...');
  }
}
