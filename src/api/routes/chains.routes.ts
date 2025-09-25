import { Router } from 'express';
import { ChainsHandler } from '../../handlers/chains.handler.js';

export function createChainsRoutes(handler: ChainsHandler): Router {
  const router = Router();

  // GET /api/chains - Get all chains or filter by challengeId
  router.get('/', handler.getChains.bind(handler));

  // GET /api/chains/:id - Get specific chain
  router.get('/:id', handler.getChain.bind(handler));

  // Note: No CREATE, UPDATE, or DELETE endpoints
  // Chains are created automatically with challenges
  // Chains are updated automatically when submissions are created

  return router;
}
