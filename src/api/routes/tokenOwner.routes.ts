import { Router } from 'express';
import { TokenOwnerHandler } from '../../handlers/tokenOwner.handler.js';

export function createTokenOwnerRoutes(tokenOwnerHandler: TokenOwnerHandler): Router {
  const router = Router();

  /**
   * GET /api/token-owner/:sha256Hash
   * 
   * Get the token owner address for a given image SHA256 hash
   * Used by verifiers to get the token owner address for client-side blockchain verification
   * 
   * Parameters:
   * - sha256Hash: string - The SHA256 hash of the image (64 hex characters)
   * 
   * Response:
   * - 200: {
   *     tokenOwnerAddress?: string,
   *     status?: 'pending' | 'verified',
   *     found: boolean
   *   }
   * - 400: Invalid hash format
   * - 500: Internal error
   * 
   * Note: Returns found=false if no record exists (not a 404)
   * This allows verifiers to distinguish between "not uploaded" and errors
   */
  router.get(
    '/token-owner/:sha256Hash',
    async (req, res, next) => {
      try {
        await tokenOwnerHandler.getTokenOwner(req, res);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}