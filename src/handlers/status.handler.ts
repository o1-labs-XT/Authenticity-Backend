import { Request, Response, NextFunction } from 'express';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
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
  constructor(private repository: SubmissionsRepository) {}

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

      // Get submission from database
      const submission = await this.repository.findBySha256Hash(sha256Hash);

      if (!submission) {
        throw Errors.notFound('Record for this SHA256 hash');
      }

      // Map submission status to expected format
      let status: 'pending' | 'verified';
      switch (submission.status) {
        case 'complete':
          status = 'verified';
          break;
        case 'awaiting_review':
        case 'processing':
        case 'rejected':
        default:
          status = 'pending';
          break;
      }

      // Return status information
      res.json({
        status,
        tokenOwnerAddress: undefined, // Submissions don't have token owner addresses
        transactionId: submission.transaction_id || undefined,
      });
    } catch (error) {
      next(error);
    }
  }
}
