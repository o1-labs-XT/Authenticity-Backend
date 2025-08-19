import { Router } from 'express';
import { StatusHandler } from '../../handlers/status.handler.js';

export function createStatusRoutes(statusHandler: StatusHandler): Router {
  const router = Router();

  /**
   * GET /api/status/:sha256Hash
   * 
   * Get the status of proof generation for an image
   * Used by the UI to poll for proof generation completion
   * 
   * Parameters:
   * - sha256Hash: string - The SHA256 hash of the image (64 hex characters)
   * 
   * Response:
   * - 200: {
   *     status: 'pending' | 'verified',
   *     tokenOwnerAddress?: string,
   *     transactionId?: string,
   *     errorMessage?: string
   *   }
   * - 404: No record found for this hash
   * - 400: Invalid hash format
   * - 500: Internal error
   */
  router.get(
    '/status/:sha256Hash',
    async (req, res, next) => {
      try {
        await statusHandler.getStatus(req, res);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
