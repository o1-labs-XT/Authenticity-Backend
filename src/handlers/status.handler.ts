import { Request, Response } from 'express';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { ErrorResponse } from '../api/middleware/error.middleware.js';
import { logger } from '../utils/logger.js';

/**
 * API response for status endpoint
 */
export interface StatusResponse {
  status: 'pending' | 'verified';
  tokenOwnerAddress?: string;
  transactionId?: string;
}

export class StatusHandler {
  constructor(private repository: AuthenticityRepository) {}

  /**
   * Get the status of a proof generation for a given SHA256 hash
   * This endpoint is used by the UI to poll for proof generation status
   */
  async getStatus(
    req: Request<{ sha256Hash: string }>,
    res: Response<StatusResponse | ErrorResponse>
  ): Promise<void> {
    try {
      const { sha256Hash } = req.params;

      // Validate SHA256 hash format
      if (!sha256Hash || !/^[a-fA-F0-9]{64}$/.test(sha256Hash)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid SHA256 hash format',
            field: 'sha256Hash',
          },
        });
        return;
      }

      // Get status from database
      const recordStatus = await this.repository.getRecordStatus(sha256Hash);

      if (!recordStatus) {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'No record found for this SHA256 hash',
          },
        });
        return;
      }

      // Return status information
      res.json({
        status: recordStatus.status as 'pending' | 'verified',
        tokenOwnerAddress: recordStatus.tokenOwnerAddress,
        transactionId: recordStatus.transactionId || undefined,
      });

    } catch (error: any) {
      logger.error({ err: error, sha256Hash }, 'Status handler error');
      
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve status',
        },
      });
    }
  }
}
