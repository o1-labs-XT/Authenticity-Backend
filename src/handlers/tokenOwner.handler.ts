import { Request, Response, NextFunction } from 'express';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
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
  constructor(private repository: AuthenticityRepository) {}

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

      // Get record from database
      const record = await this.repository.getRecordByHash(sha256Hash);

      if (!record) {
        // No record found - image has not been verified on chain
        res.json({
          found: false,
        });
        return;
      }

      // Return token owner address and status
      res.json({
        tokenOwnerAddress: record.token_owner_address,
        status: record.status as 'pending' | 'verified',
        found: true,
      });
    } catch (error) {
      next(error);
    }
  }
}
