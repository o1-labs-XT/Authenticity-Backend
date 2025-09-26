import { Router } from 'express';
import { UsersHandler } from '../../handlers/users.handler.js';

export function createUsersRoutes(handler: UsersHandler): Router {
  const router = Router();

  router.get('/:walletAddress', handler.getUser.bind(handler));
  router.post('/', handler.createUser.bind(handler));
  // todo: restrict to admins
  router.delete('/:walletAddress', handler.deleteUser.bind(handler));

  return router;
}
