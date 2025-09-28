import { Router } from 'express';
import { ChallengesHandler } from '../../handlers/challenges.handler.js';
import { requireAdmin } from '../middleware/adminAuth.js';

export function createChallengesRoutes(handler: ChallengesHandler): Router {
  const router = Router();

  // Public endpoints
  router.get('/active', handler.getActiveChallenges.bind(handler));
  router.get('/:id', handler.getChallenge.bind(handler));
  router.get('/', handler.getAllChallenges.bind(handler));

  // Admin-only endpoints
  router.post('/', requireAdmin, handler.createChallenge.bind(handler));
  router.delete('/:id', requireAdmin, handler.deleteChallenge.bind(handler));

  return router;
}
