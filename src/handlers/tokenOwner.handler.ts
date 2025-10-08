import { Request, Response, NextFunction } from 'express';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { ErrorResponse } from '../api/middleware/error.middleware.js';
import { Errors } from '../utils/errors.js';

/**
 * API response for token owner endpoint
 */
export interface TokenOwnerResponse {
  tokenOwnerAddress?: string;
  status?: 'pending' | 'verified';
  found: boolean;
}

export class TokenOwnerHandler {
  constructor(private repository: SubmissionsRepository) {}

  /**
   * Get the token owner address for a given SHA256 hash
   * This endpoint is used by verifiers to get the token owner address
   * for client-side blockchain verification
   */
  async getTokenOwner(
    req: Request<{ sha256Hash: string }>,
    res: Response<TokenOwnerResponse | ErrorResponse>,
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
        // No submission found - image has not been submitted
        res.json({
          found: false,
        });
        return;
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

      // Return status (submissions don't have token owner addresses)
      res.json({
        tokenOwnerAddress: undefined, // Submissions don't have token owner addresses
        status,
        found: true,
      });
    } catch (error) {
      next(error);
    }
  }
}
