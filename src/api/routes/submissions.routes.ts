import { Router } from 'express';
import { SubmissionsHandler } from '../../handlers/submissions.handler.js';
import { imageUpload } from '../middleware/imageUpload.middleware.js';

export function createSubmissionsRoutes(handler: SubmissionsHandler): Router {
  const router = Router();

  router.post('/', imageUpload.single('image'), handler.createSubmission.bind(handler));
  router.get('/:id', handler.getSubmission.bind(handler));
  router.get('/', handler.getSubmissions.bind(handler));
  router.delete('/:id', handler.deleteSubmission.bind(handler));

  return router;
}
