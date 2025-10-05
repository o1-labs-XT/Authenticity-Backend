import { Router } from 'express';
import { SubmissionsHandler } from '../../handlers/submissions.handler.js';
import { imageUpload } from '../middleware/imageUpload.middleware.js';
import { requireAdmin } from '../middleware/adminAuth.js';

export function createSubmissionsRoutes(handler: SubmissionsHandler): Router {
  const router = Router();

  // Public endpoints
  router.post('/', imageUpload.single('image'), handler.createSubmission.bind(handler));
  router.get('/:id/image', handler.getSubmissionImage.bind(handler));
  router.get('/:id', handler.getSubmission.bind(handler));
  router.get('/', handler.getSubmissions.bind(handler));

  // Admin-only endpoints
  router.patch('/:id', requireAdmin, handler.reviewSubmission.bind(handler));
  router.delete('/:id', requireAdmin, handler.deleteSubmission.bind(handler));

  return router;
}
