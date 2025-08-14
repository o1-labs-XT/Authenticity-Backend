import { Request, Response } from 'express';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { StatusResponse, ErrorResponse } from '../types/index.js';

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
        status: recordStatus.status as 'pending' | 'verified' | 'failed',
        tokenOwnerAddress: recordStatus.tokenOwnerAddress,
        transactionId: recordStatus.transactionId || undefined,
        errorMessage: recordStatus.errorMessage || undefined,
      });

    } catch (error: any) {
      console.error('Status handler error:', error);
      
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve status',
        },
      });
    }
  }

  /**
   * Get detailed statistics (optional admin endpoint)
   */
  async getStatistics(req: Request, res: Response): Promise<void> {
    try {
      const stats = await this.repository.getStatistics();
      res.json(stats);
    } catch (error: any) {
      console.error('Statistics handler error:', error);
      
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve statistics',
        },
      });
    }
  }
}