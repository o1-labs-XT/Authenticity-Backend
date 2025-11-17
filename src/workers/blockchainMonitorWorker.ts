import PgBoss from 'pg-boss';
import {
  SubmissionsRepository,
  TransactionInfo,
} from '../db/repositories/submissions.repository.js';
import { BlockchainMonitoringJobData } from '../services/queue/jobQueue.service.js';
import { ArchiveNodeService } from '../services/blockchain/archiveNode.service.js';
import { MinaNodeService } from '../services/blockchain/minaNode.service.js';
import { BlockchainMonitoringService } from '../services/blockchain/monitoring.service.js';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';

export class BlockchainMonitorWorker {
  constructor(
    private boss: PgBoss,
    private repository: SubmissionsRepository,
    private archiveNodeService: ArchiveNodeService,
    private minaNodeService: MinaNodeService,
    private monitoringService: BlockchainMonitoringService
  ) {}

  async start(): Promise<void> {
    // Handle blockchain monitoring jobs
    await this.boss.work<BlockchainMonitoringJobData>('blockchain-monitoring', async (jobs) => {
      for (const job of jobs) {
        await this.processMonitoringJob(job);
      }
    });

    logger.info('Blockchain monitoring worker started');
  }

  async stop(): Promise<void> {
    // pg-boss handles stopping workers gracefully
    logger.info('Stopping blockchain monitoring worker...');
  }

  private async processMonitoringJob(job: PgBoss.Job<BlockchainMonitoringJobData>): Promise<void> {
    await withContext(
      {
        jobId: job.id,
        jobType: 'blockchain-monitoring',
      },
      async () => {
        const totalTracker = new PerformanceTracker('job.blockchainMonitoring');
        const lookbackBlocks = job.data.lookbackBlocks || 100;

        logger.info({ lookbackBlocks }, 'Starting blockchain monitoring job');

        try {
          // Step 1: Get current block height
          const currentHeight = await this.minaNodeService.getCurrentBlockHeight();
          const fromHeight = currentHeight - lookbackBlocks;
          const toHeight = currentHeight;

          logger.debug(
            { currentHeight, fromHeight, toHeight, lookbackBlocks },
            'Monitoring blockchain range'
          );

          // Step 2: Load recent transactions from database
          const dbTransactions =
            await this.repository.getRecentTransactionsForMonitoring(lookbackBlocks);
          const submittedTxs = new Map<string, TransactionInfo>();

          for (const tx of dbTransactions) {
            submittedTxs.set(tx.hash, tx);
          }

          logger.debug(
            { transactionCount: submittedTxs.size },
            'Loaded transactions from database'
          );

          // Step 3: Get active zkApp addresses from challenges
          const activeZkAppAddresses = await this.repository.getActiveZkAppAddresses();

          if (activeZkAppAddresses.length === 0) {
            logger.info('No active zkApp addresses found, skipping monitoring');
            return;
          }

          logger.debug({ zkAppCount: activeZkAppAddresses.length }, 'Found active zkApp addresses');

          // Step 4: Query archive node for actions from all zkApps
          const archiveTracker = new PerformanceTracker('job.archiveQuery');
          let allActions: any[] = [];

          for (const zkAppAddress of activeZkAppAddresses) {
            try {
              const actionsResponse = await this.archiveNodeService.fetchActionsWithBlockInfo(
                zkAppAddress,
                fromHeight,
                toHeight,
                false // Don't log the request
              );
              allActions = [...allActions, ...actionsResponse];
              logger.debug(
                { zkAppAddress, actionsCount: actionsResponse.length },
                'Retrieved actions for zkApp'
              );
            } catch (error) {
              logger.error({ zkAppAddress, err: error }, 'Failed to fetch actions for zkApp');
              // Continue with other zkApps even if one fails
            }
          }

          const archiveQueryDuration = archiveTracker.end('success');

          logger.debug(
            { totalActionsCount: allActions.length },
            'Retrieved all actions from archive node'
          );

          // Step 5: Aggregate transaction status
          const report = this.monitoringService.aggregateTransactionStatus(
            submittedTxs,
            allActions,
            currentHeight
          );

          // Step 6: Log the results
          const totalDuration = totalTracker.end('success');
          this.monitoringService.logTransactionStatus(
            report,
            currentHeight,
            { from: fromHeight, to: toHeight },
            {
              archiveQueryDurationMs: archiveQueryDuration,
              totalDurationMs: totalDuration,
            }
          );

          logger.info('Blockchain monitoring job completed successfully');
        } catch (error) {
          totalTracker.end('error');
          logger.error({ err: error }, 'Blockchain monitoring job failed');
          // Don't throw - monitoring failures shouldn't crash the worker
        }
      }
    );
  }
}
