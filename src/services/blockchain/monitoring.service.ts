import { logger } from '../../utils/logger.js';
import { ActionResult } from './archiveNode.service.js';
import { TransactionInfo } from '../../db/repositories/submissions.repository.js';

export interface TransactionStatusReport {
  pending: TransactionInfo[];
  included: TransactionInfo[];
  final: TransactionInfo[];
  abandoned: TransactionInfo[];
  summary: {
    total: number;
    pendingCount: number;
    includedCount: number;
    finalCount: number;
    abandonedCount: number;
  };
}

export interface MonitoringLogEntry {
  timestamp: string;
  currentBlockHeight: number;
  queryRange: { from: number; to: number };
  transactionCounts: {
    submitted: number;
    pending: number;
    included: number;
    final: number;
    abandoned: number;
  };
  sampleTransactions: {
    pending: string[]; // First 3 tx hashes
    included: string[]; // First 3 tx hashes
    final: string[]; // First 3 tx hashes
    abandoned: string[]; // First 3 tx hashes
  };
  performance: {
    archiveQueryDurationMs: number;
    totalDurationMs: number;
  };
}

export class BlockchainMonitoringService {
  private readonly WAIT_BLOCKS = 15; // Confirmations needed for final status
  private readonly ABANDONMENT_BLOCKS = 15; // Blocks before considering abandoned

  constructor() {}

  aggregateTransactionStatus(
    submittedTxs: Map<string, TransactionInfo>,
    actionsResponse: ActionResult[],
    currentHeight: number
  ): TransactionStatusReport {
    const pending: TransactionInfo[] = [];
    const included: TransactionInfo[] = [];
    const final: TransactionInfo[] = [];
    const abandoned: TransactionInfo[] = [];

    const matchedTxHashes = new Set<string>();

    // Iterate over GraphQL response and match transaction hashes
    for (const entry of actionsResponse) {
      for (const actionData of entry.actionData) {
        const txHash = actionData.transactionInfo.hash;
        const distanceFromMax = entry.blockInfo.distanceFromMaxBlockHeight || 0;

        if (txHash && submittedTxs.has(txHash)) {
          const txInfo = submittedTxs.get(txHash)!;
          matchedTxHashes.add(txHash);

          // Use distanceFromMaxBlockHeight for confirmations calculation
          // If distance is negative, it means blocks have advanced beyond this block
          const confirmations = Math.abs(distanceFromMax);

          if (confirmations >= this.WAIT_BLOCKS) {
            final.push(txInfo);
          } else {
            included.push(txInfo);
          }
        }
      }
    }

    // Check remaining submitted transactions for pending/abandoned status
    for (const [txHash, txInfo] of submittedTxs) {
      if (!matchedTxHashes.has(txHash)) {
        const blocksSinceSubmission = currentHeight - txInfo.submittedHeight;

        if (blocksSinceSubmission > this.ABANDONMENT_BLOCKS) {
          abandoned.push(txInfo);
        } else {
          pending.push(txInfo);
        }
      }
    }

    return {
      pending,
      included,
      final,
      abandoned,
      summary: {
        total: submittedTxs.size,
        pendingCount: pending.length,
        includedCount: included.length,
        finalCount: final.length,
        abandonedCount: abandoned.length,
      },
    };
  }

  logTransactionStatus(
    report: TransactionStatusReport,
    currentBlockHeight: number,
    queryRange: { from: number; to: number },
    performance: { archiveQueryDurationMs: number; totalDurationMs: number }
  ): void {
    const sampleSize = 3;

    const logEntry: MonitoringLogEntry = {
      timestamp: new Date().toISOString(),
      currentBlockHeight,
      queryRange,
      transactionCounts: {
        submitted: report.summary.total,
        pending: report.summary.pendingCount,
        included: report.summary.includedCount,
        final: report.summary.finalCount,
        abandoned: report.summary.abandonedCount,
      },
      sampleTransactions: {
        pending: report.pending.slice(0, sampleSize).map((tx) => tx.hash.slice(0, 8)),
        included: report.included.slice(0, sampleSize).map((tx) => tx.hash.slice(0, 8)),
        final: report.final.slice(0, sampleSize).map((tx) => tx.hash.slice(0, 8)),
        abandoned: report.abandoned.slice(0, sampleSize).map((tx) => tx.hash.slice(0, 8)),
      },
      performance,
    };

    logger.info(logEntry, 'Blockchain transaction status monitoring report');

    // Log detailed breakdown if there are any interesting transactions
    if (report.summary.abandonedCount > 0) {
      logger.warn(
        {
          abandonedCount: report.summary.abandonedCount,
          abandonedHashes: report.abandoned.map((tx) => tx.hash.slice(0, 8)),
        },
        'Found abandoned transactions'
      );
    }

    if (report.summary.pendingCount > 10) {
      logger.warn(
        {
          pendingCount: report.summary.pendingCount,
          currentHeight: currentBlockHeight,
        },
        'High number of pending transactions detected'
      );
    }
  }
}
