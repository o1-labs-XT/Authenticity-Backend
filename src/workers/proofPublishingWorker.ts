import PgBoss from 'pg-boss';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { ProofPublishingService } from '../services/zk/proofPublishing.service.js';
import { ProofPublishingJobData } from '../services/queue/jobQueue.service.js';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';
import { config } from '../config/index.js';

export class ProofPublishingWorker {
  private processedJobCount = 0;
  private readonly MAX_JOBS_BEFORE_RESTART = config.workerMaxJobsBeforeRestart;

  constructor(
    private boss: PgBoss,
    private submissionsRepository: SubmissionsRepository,
    private proofPublishingService: ProofPublishingService
  ) {}

  /**
   * Handles proof publishing job for generated proofs
   * Deserializes proof from database and publishes to Mina blockchain
   */
  async start(): Promise<void> {
    await this.boss.work<ProofPublishingJobData>(
      'proof-publishing',
      { includeMetadata: true },
      async (jobs: PgBoss.JobWithMetadata<ProofPublishingJobData>[]) => {
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
              const jobTracker = new PerformanceTracker('job.proofPublishing', {
                sha256Hash: job.data.sha256Hash,
              });
              logger.info('Starting proof publishing job');

              const { sha256Hash, tokenOwnerPrivateKey } = job.data;

              try {
                // Step 1: Fetch submission with transaction JSON
                const submission = await this.submissionsRepository.findBySha256Hash(sha256Hash);

                if (!submission?.transaction_json) {
                  throw new Error('Transaction JSON not found in database');
                }

                // Step 2: Sign and send pre-created transaction
                logger.info('Signing and sending pre-created transaction');
                const publishTracker = new PerformanceTracker('publish.signAndSend');
                const transactionId = await this.proofPublishingService.signAndSendTransaction(
                  sha256Hash,
                  submission.transaction_json,
                  tokenOwnerPrivateKey
                );
                publishTracker.end('success', { transactionId });

                // Step 3: Update status and clear transaction_json
                const verifiedAt = new Date().toISOString();

                await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
                  status: 'complete',
                  verified_at: verifiedAt,
                  transaction_json: null, // Clear transaction to save database space
                });

                jobTracker.end('success', { transactionId });
                logger.info({ transactionId }, 'Proof publishing completed successfully');
              } catch (error) {
                const isLastRetry = retryCount >= config.workerRetryLimit - 1;

                logger.error(
                  {
                    err: error,
                    isLastRetry,
                  },
                  'Proof publishing failed'
                );

                // Update failure status on last retry
                if (isLastRetry) {
                  const failedAt = new Date().toISOString();
                  const failureReason = error instanceof Error ? error.message : String(error);

                  await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
                    status: 'rejected',
                    failed_at: failedAt,
                    failure_reason: failureReason,
                    transaction_json: null, // Clear transaction on final failure
                  });
                }

                // Re-throw error to trigger pg-boss retry
                throw error;
              } finally {
                // Increment job counter and check for restart (runs for both success and failure)
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
              }
            }
          );
        }
      }
    );

    logger.info('Proof publishing worker started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping proof publishing worker...');
  }
}
