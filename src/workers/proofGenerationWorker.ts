import PgBoss from 'pg-boss';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import {
  ImageAuthenticityService,
  ECDSASignatureData,
} from '../services/image/verification.service.js';
import { MinioStorageService } from '../services/storage/minio.service.js';
import { ProofGenerationService } from '../services/zk/proofGeneration.service.js';
import { ProofPublishingService } from '../services/zk/proofPublishing.service.js';
import { ProofGenerationJobData } from '../services/queue/jobQueue.service.js';
import fs from 'fs/promises';
import path from 'path';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';
import { Errors } from '../utils/errors.js';
import { config } from '../config/index.js';

export class ProofGenerationWorker {
  private processedJobCount = 0;
  private readonly MAX_JOBS_BEFORE_RESTART = config.workerMaxJobsBeforeRestart;

  constructor(
    private boss: PgBoss,
    private submissionsRepository: SubmissionsRepository,
    private imageAuthenticityService: ImageAuthenticityService,
    private proofGenerationService: ProofGenerationService,
    private proofPublishingService: ProofPublishingService,
    private storageService: MinioStorageService
  ) {}

  /**
   * Handles proof generation job queued by an admin approving a submission
   * loads image from minio, generates verificationInputs for proof generation
   * runs proof generation and triggers proof publishing
   */
  async start(): Promise<void> {
    await this.boss.work<ProofGenerationJobData>(
      'proof-generation',
      { includeMetadata: true },
      async (jobs: PgBoss.JobWithMetadata<ProofGenerationJobData>[]) => {
        // Process jobs one at a time (batch size is 1)
        for (const job of jobs) {
          const retryCount = job.retryCount || 0;

          await withContext(
            {
              jobId: job.id,
              sha256Hash: job.data.sha256Hash,
              correlationId: job.data.correlationId,
              attempt: retryCount,
            },
            async () => {
              const jobTracker = new PerformanceTracker('job.proofGeneration', {
                sha256Hash: job.data.sha256Hash,
              });
              logger.info('Starting proof generation job');

              const {
                sha256Hash,
                signature,
                storageKey,
                tokenOwnerAddress: _tokenOwnerAddress, // TODO: remove
                tokenOwnerPrivateKey,
                zkAppAddress,
              } = job.data;

              // Parse ECDSA signature from JSON and get public key from config
              let signatureData: ECDSASignatureData;
              try {
                const sigData = JSON.parse(signature);
                const publicKeyParts = config.signerPublicKey.split(',');
                if (publicKeyParts.length !== 2) {
                  throw new Error('SIGNER_PUBLIC_KEY must be in format "x,y" (hex strings)');
                }
                signatureData = {
                  signatureR: sigData.r,
                  signatureS: sigData.s,
                  publicKeyX: publicKeyParts[0].trim(),
                  publicKeyY: publicKeyParts[1].trim(),
                };
              } catch (parseError) {
                const errorMessage =
                  parseError instanceof Error ? parseError.message : 'Invalid JSON format';
                throw Errors.internal(`Failed to parse ECDSA signature data: ${errorMessage}`);
              }

              // temporary location for image downloaded from minio
              const tempPath = path.join(config.workerTempDir, `${sha256Hash}.png`);

              try {
                // Update status to processing
                const processingStartedAt = new Date().toISOString();

                await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
                  status: 'processing',
                  processing_started_at: processingStartedAt,
                  retry_count: retryCount,
                });

                // Step 1: Download image from MinIO to temp file
                const imageBuffer = await this.storageService.downloadImage(storageKey);
                await fs.writeFile(tempPath, imageBuffer);

                // Step 2: Verify and prepare image
                // POST submission handler also verifies the image but we run this to get the verificationInputs
                logger.info('Verifying and preparing ECDSA signature');
                const verifyTracker = new PerformanceTracker('job.verifyImage');
                const { isValid, verificationInputs, commitment, error } =
                  this.imageAuthenticityService.verifyAndPrepareImage(tempPath, signatureData);
                verifyTracker.end(isValid ? 'success' : 'error');

                if (!isValid || !verificationInputs || !commitment) {
                  throw Errors.internal(
                    `ECDSA signature verification failed: ${error || 'Unknown error'}`
                  );
                }

                // Step 3: Generate proof
                logger.info('Generating zero-knowledge proof');
                const proofTracker = new PerformanceTracker('job.generateProof');
                const { proof, publicInputs } = await this.proofGenerationService.generateProof(
                  sha256Hash,
                  signatureData,
                  commitment,
                  verificationInputs,
                  tempPath
                );
                proofTracker.end('success');

                // Step 4: Publish to blockchain
                logger.info('Publishing proof to Mina blockchain');
                const publishTracker = new PerformanceTracker('job.publishProof');

                const transactionId = await this.proofPublishingService.publishProof(
                  sha256Hash,
                  proof,
                  publicInputs,
                  tokenOwnerPrivateKey,
                  zkAppAddress
                );
                publishTracker.end('success', { transactionId });

                // Step 5: Update database with success
                const verifiedAt = new Date().toISOString();

                await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
                  status: 'complete',
                  transaction_id: transactionId,
                  verified_at: verifiedAt,
                });

                jobTracker.end('success', { transactionId });
                logger.info({ transactionId }, 'Proof generation completed successfully');

                // Increment job counter and check for restart
                this.processedJobCount++;
                logger.info(
                  {
                    processedJobCount: this.processedJobCount,
                    maxJobs: this.MAX_JOBS_BEFORE_RESTART,
                  },
                  'Job completed, checking restart threshold'
                );

                if (this.processedJobCount >= this.MAX_JOBS_BEFORE_RESTART) {
                  logger.info(
                    { processedJobCount: this.processedJobCount },
                    'Reached max jobs threshold, initiating graceful restart'
                  );

                  // Schedule graceful shutdown after a brief delay to complete current job
                  setTimeout(() => {
                    logger.info('Sending SIGTERM for graceful restart');
                    process.kill(process.pid, 'SIGTERM');
                  }, 1000);
                }
              } catch (error) {
                const isLastRetry = retryCount >= config.workerRetryLimit - 1;

                logger.error(
                  {
                    err: error,
                    isLastRetry,
                  },
                  'Proof generation failed'
                );

                // Update failure status
                const failedAt = isLastRetry ? new Date().toISOString() : null;
                const failureReason =
                  error instanceof Error
                    ? error.message
                    : typeof error === 'string'
                      ? error
                      : 'Unknown error occurred';
                const newRetryCount = retryCount + 1;

                await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
                  status: isLastRetry ? 'rejected' : 'awaiting_review',
                  failed_at: failedAt,
                  failure_reason: failureReason,
                  retry_count: newRetryCount,
                });

                // Re-throw error to trigger pg-boss retry
                throw error;
              } finally {
                // Clean up temp file - always runs regardless of success or failure
                try {
                  await fs.rm(tempPath, { force: true });
                  logger.debug('Cleaned up temp file');
                } catch (cleanupError) {
                  logger.warn({ err: cleanupError }, 'Failed to clean up temp file');
                }
              }
            }
          );
        }
      }
    );

    logger.info('Proof generation worker started');
  }

  async stop(): Promise<void> {
    // pg-boss handles stopping workers gracefully
    logger.info('Stopping worker...');
  }
}
