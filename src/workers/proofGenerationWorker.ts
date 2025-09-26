import PgBoss from 'pg-boss';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { ImageAuthenticityService } from '../services/image/verification.service.js';
import { MinioStorageService } from '../services/storage/minio.service.js';
import { ProofGenerationService } from '../services/zk/proofGeneration.service.js';
import { ProofPublishingService } from '../services/zk/proofPublishing.service.js';
import { ProofGenerationJobData } from '../services/queue/jobQueue.service.js';
import fs from 'fs/promises';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';
import { Errors } from '../utils/errors.js';

export class ProofGenerationWorker {
  constructor(
    private boss: PgBoss,
    private repository: AuthenticityRepository,
    private imageAuthenticityService: ImageAuthenticityService,
    private proofGenerationService: ProofGenerationService,
    private proofPublishingService: ProofPublishingService,
    private storageService: MinioStorageService
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
            // todo: retrycount isn't behaving as expected, investigate
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
              storageKey,
              tokenOwnerAddress: _tokenOwnerAddress, // currently unused
              tokenOwnerPrivateKey,
            } = job.data;

            logger.info('Starting proof generation job');

            // temporary location for image downloaded from minio
            const tempPath = `/tmp/${sha256Hash}.png`;

            try {
              // Update status to processing
              await this.repository.updateRecord(sha256Hash, {
                status: 'processing',
                processing_started_at: new Date().toISOString(),
                retry_count:
                  (job as PgBoss.JobWithMetadata<ProofGenerationJobData>).retryCount || 0,
              });

              // Step 1: Download image from MinIO to temp file
              const imageBuffer = await this.storageService.downloadImage(storageKey);
              await fs.writeFile(tempPath, imageBuffer);

              // Step 2: Verify and prepare image
              // todo: upload handler is already doing this
              logger.info('Verifying and preparing image');
              const verifyTracker = new PerformanceTracker('job.verifyImage');
              const { isValid, verificationInputs, error } =
                this.imageAuthenticityService.verifyAndPrepareImage(tempPath, signature, publicKey);
              verifyTracker.end(isValid ? 'success' : 'error');

              if (!isValid || !verificationInputs) {
                throw Errors.internal(`Image verification failed: ${error || 'Unknown error'}`);
              }

              // Step 2: Generate proof
              logger.info('Generating zero-knowledge proof');
              const proofTracker = new PerformanceTracker('job.generateProof');
              const { proof, publicInputs } = await this.proofGenerationService.generateProof(
                sha256Hash,
                publicKey,
                signature,
                verificationInputs,
                tempPath
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

              // Clean up temp file and MinIO
              try {
                await fs.unlink(tempPath);
                await this.storageService.deleteImage(storageKey); // Delete from MinIO
                logger.debug('Cleaned up temp file and MinIO');
              } catch (cleanupError) {
                logger.warn({ err: cleanupError }, 'Failed to clean up');
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

              // Clean up on final failure
              // todo: revisit failure logic, we'll probably want to retain failed records
              if (isLastRetry) {
                try {
                  await fs.unlink(tempPath);
                  await this.storageService.deleteImage(storageKey);
                  logger.debug('Cleaned up after final failure');
                } catch (cleanupError) {
                  logger.warn({ err: cleanupError }, 'Failed to clean up after failure');
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
