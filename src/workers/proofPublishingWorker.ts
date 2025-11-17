import PgBoss from 'pg-boss';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { ProofPublishingService } from '../services/zk/proofPublishing.service.js';
import { ProofPublishingJobData } from '../services/queue/jobQueue.service.js';
import { AuthenticityProgram, AuthenticityProof } from 'authenticity-zkapp';
import { Cache, JsonProof } from 'o1js';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';
import { config } from '../config/index.js';

export class ProofPublishingWorker {
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

              const { sha256Hash, zkAppAddress } = job.data;

              try {
                // Step 1: Fetch submission with proof
                const submission = await this.submissionsRepository.findBySha256Hash(sha256Hash);

                if (!submission?.proof_json) {
                  throw new Error('Proof JSON not found in database');
                }

                // Step 2: Compile AuthenticityProgram (required for proof deserialization)
                logger.info('Compiling AuthenticityProgram for proof deserialization');
                const cache = Cache.FileSystem(config.circuitCachePath);
                const compileTracker = new PerformanceTracker('publish.compileProgram');
                await AuthenticityProgram.compile({ cache });
                compileTracker.end('success');

                // Step 3: Deserialize proof from JSON
                logger.info('Deserializing proof from JSON');
                const deserializeTracker = new PerformanceTracker('publish.deserializeProof');
                const proof = await AuthenticityProof.fromJSON(submission.proof_json as JsonProof);
                deserializeTracker.end('success');

                // Step 4: Publish to blockchain
                logger.info('Publishing proof to Mina blockchain');
                const publishTracker = new PerformanceTracker('publish.transaction');
                const transactionId = await this.proofPublishingService.publishProof(
                  sha256Hash,
                  proof,
                  zkAppAddress
                );
                publishTracker.end('success', { transactionId });

                // Step 5: Update status and clear proof_json
                const verifiedAt = new Date().toISOString();

                await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
                  status: 'complete',
                  verified_at: verifiedAt,
                  proof_json: null, // Clear proof to save database space
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
                    proof_json: null, // Clear proof on final failure
                  });
                }

                // Re-throw error to trigger pg-boss retry
                throw error;
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
