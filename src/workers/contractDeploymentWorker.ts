import PgBoss from 'pg-boss';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import { ContractDeploymentService } from '../services/zk/contractDeployment.service.js';
import { ContractDeploymentJobData } from '../services/queue/jobQueue.service.js';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';
import { config } from '../config/index.js';

export class ContractDeploymentWorker {
  constructor(
    private boss: PgBoss,
    private challengesRepository: ChallengesRepository,
    private deploymentService: ContractDeploymentService
  ) {}

  async start(): Promise<void> {
    logger.info('Contract deployment worker starting');

    await this.boss.work<ContractDeploymentJobData>(
      'contract-deployment',
      {
        includeMetadata: true,
        batchSize: 1, // Mina transactions doesn't support concurrency, process one job at a time
      },
      async (jobs: PgBoss.JobWithMetadata<ContractDeploymentJobData>[]) => {
        for (const job of jobs) {
          const retryCount = job.retryCount || 0;

          await withContext(
            {
              jobId: job.id,
              challengeId: job.data.challengeId,
              correlationId: job.data.correlationId,
              attempt: retryCount,
            },
            async () => {
              const jobTracker = new PerformanceTracker('job.contractDeployment', {
                challengeId: job.data.challengeId,
              });
              logger.info('Starting contract deployment job');

              const { challengeId } = job.data;

              // Query challenge for logging context
              let challenge;
              try {
                challenge = await this.challengesRepository.findById(challengeId);
                if (challenge) {
                  logger.info(
                    { challengeTitle: challenge.title },
                    'Deploying contract for challenge'
                  );
                }
              } catch (error) {
                logger.warn({ err: error }, 'Failed to fetch challenge details for logging');
              }

              try {
                // Update status to deploying
                await this.challengesRepository.update(challengeId, {
                  deployment_status: 'deploying',
                });

                // Deploy contract
                logger.info({ challengeId }, 'Deploying contract');
                const result = await this.deploymentService.deployContract(challengeId);

                if (!result.success) {
                  throw new Error(result.error || 'Unknown deployment error');
                }

                // Update challenge with deployment success
                await this.challengesRepository.update(challengeId, {
                  deployment_status: 'active',
                  zkapp_address: result.zkAppAddress,
                  transaction_id: result.txHash,
                  failure_reason: null,
                });

                jobTracker.end('success', {
                  zkAppAddress: result.zkAppAddress,
                  txHash: result.txHash,
                });
                logger.info(
                  { zkAppAddress: result.zkAppAddress, txHash: result.txHash },
                  'Contract deployment completed successfully'
                );
              } catch (error) {
                const isLastRetry = retryCount >= config.workerRetryLimit - 1;

                logger.error({ err: error, isLastRetry }, 'Contract deployment failed');

                // Update failure status
                const failureReason = error instanceof Error ? error.message : String(error);

                await this.challengesRepository.update(challengeId, {
                  deployment_status: isLastRetry ? 'deployment_failed' : 'deploying',
                  failure_reason: failureReason,
                });

                // Re-throw to trigger pg-boss retry
                throw error;
              }
            }
          );
        }
      }
    );

    logger.info('Contract deployment worker started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping contract deployment worker...');
  }
}
