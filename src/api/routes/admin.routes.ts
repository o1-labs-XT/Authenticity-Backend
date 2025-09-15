import { Router, Request, Response, NextFunction } from 'express';
import { AdminHandler } from '../../handlers/admin.handler.js';
import { config } from '../../config/index.js';

export function createAdminRoutes(adminHandler: AdminHandler): Router {
  const router = Router();

  // Basic auth middleware for admin endpoints
  const adminAuth = (req: Request, res: Response, next: NextFunction) => {
    // In production, implement proper authentication
    // For now, check if NODE_ENV is development or if a specific header is present
    if (config.nodeEnv === 'development') {
      return next();
    }

    const adminKey = req.headers['x-admin-key'];
    if (adminKey === process.env.ADMIN_API_KEY) {
      return next();
    }

    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Admin authentication required',
      },
    });
  };

  // Apply auth to all admin routes
  router.use('/admin', adminAuth);

  // Job statistics
  router.get('/admin/jobs/stats', (req, res) => adminHandler.getJobStats(req, res));

  // Retry a specific job
  router.post('/admin/jobs/:jobId/retry', (req, res) => adminHandler.retryJob(req, res));

  // Get failed jobs
  router.get('/admin/jobs/failed', (req, res) => adminHandler.getFailedJobs(req, res));

  // Get job details
  router.get('/admin/jobs/:jobId', (req, res) => adminHandler.getJobDetails(req, res));

  return router;
}
