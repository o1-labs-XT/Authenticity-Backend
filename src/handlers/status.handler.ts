import { Request, Response, NextFunction } from 'express';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { ErrorResponse } from '../api/middleware/error.middleware.js';
import { Errors } from '../utils/errors.js';

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
    res: Response<StatusResponse | ErrorResponse>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { sha256Hash } = req.params;

      // Validate SHA256 hash format
      if (!sha256Hash || !/^[a-fA-F0-9]{64}$/.test(sha256Hash)) {
        throw Errors.badRequest('Invalid SHA256 hash format', 'sha256Hash');
      }

      // Get status from database
      const recordStatus = await this.repository.getRecordStatus(sha256Hash);

      if (!recordStatus) {
        throw Errors.notFound('Record for this SHA256 hash');
      }

      // Return status information
      res.json({
        status: recordStatus.status as 'pending' | 'verified',
        tokenOwnerAddress: recordStatus.tokenOwnerAddress,
        transactionId: recordStatus.transactionId || undefined,
      });
    } catch (error) {
      next(error);
    }
  }
}
