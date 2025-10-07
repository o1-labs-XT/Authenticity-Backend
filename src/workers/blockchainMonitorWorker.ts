import PgBoss from 'pg-boss';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { BlockchainMonitoringJobData } from '../services/queue/jobQueue.service.js';
import { ArchiveNodeService } from '../services/blockchain/archiveNode.service.js';
import { MinaNodeService } from '../services/blockchain/minaNode.service.js';
import {
  BlockchainMonitoringService,
  TransactionInfo,
} from '../services/blockchain/monitoring.service.js';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';

export class BlockchainMonitorWorker {
  constructor(
    private boss: PgBoss,
    private repository: AuthenticityRepository,
    private archiveNodeService: ArchiveNodeService,
    private minaNodeService: MinaNodeService,
    private monitoringService: BlockchainMonitoringService,
    private zkappAddress: string
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

          // Step 3: Query archive node for actions
          const archiveTracker = new PerformanceTracker('job.archiveQuery');
          const actionsResponse = await this.archiveNodeService.fetchActionsWithBlockInfo(
            this.zkappAddress,
            fromHeight,
            toHeight,
            false // Don't log the request
          );
          const archiveQueryDuration = archiveTracker.end('success');

          logger.debug(
            { actionsCount: actionsResponse.length },
            'Retrieved actions from archive node'
          );

          // Step 4: Aggregate transaction status
          const report = this.monitoringService.aggregateTransactionStatus(
            submittedTxs,
            actionsResponse,
            currentHeight
          );

          // Step 5: Log the results
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
