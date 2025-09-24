import { Router } from 'express';
import { ChallengesHandler } from '../../handlers/challenges.handler.js';

export function createChallengesRoutes(handler: ChallengesHandler): Router {
  const router = Router();

  router.get('/current', handler.getCurrentChallenge.bind(handler));
  router.get('/:id', handler.getChallenge.bind(handler));
  router.get('/', handler.getAllChallenges.bind(handler));
  router.post('/', handler.createChallenge.bind(handler));
  router.delete('/:id', handler.deleteChallenge.bind(handler));

  return router;
}
