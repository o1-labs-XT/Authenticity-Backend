import { Router } from 'express';
import { UsersHandler } from '../../handlers/users.handler.js';
import { requireAdmin } from '../middleware/adminAuth.js';

export function createUsersRoutes(handler: UsersHandler): Router {
  const router = Router();

  // Public endpoints
  router.get('/:walletAddress', handler.getUser.bind(handler));
  router.post('/', handler.createUser.bind(handler));

  // Admin-only endpoint
  router.delete('/:walletAddress', requireAdmin, handler.deleteUser.bind(handler));

  return router;
}
