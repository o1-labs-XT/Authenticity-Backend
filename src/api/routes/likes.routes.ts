import { Router } from 'express';
import { LikesHandler } from '../../handlers/likes.handler.js';

export function createLikesRoutes(handler: LikesHandler): Router {
  const router = Router({ mergeParams: true }); // Important: mergeParams allows access to :submissionId from parent route

  router.post('/', handler.createLike.bind(handler));
  router.get('/count', handler.getLikeCount.bind(handler)); // Must be before /:walletAddress
  router.get('/', handler.getLikes.bind(handler));
  router.delete('/:walletAddress', handler.deleteLike.bind(handler));

  return router;
}
