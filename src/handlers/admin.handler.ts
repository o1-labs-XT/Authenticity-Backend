import { Request, Response } from 'express';
import { JobQueueService } from '../services/queue/jobQueue.service.js';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { logger } from '../utils/logger.js';

export class AdminHandler {
  constructor(
    private jobQueue: JobQueueService,
    private repository: SubmissionsRepository
  ) {}

  async getJobStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await this.jobQueue.getQueueStats();

      // Get database stats
      const dbStats = await this.repository.getStatusCounts();

      res.json({
        queue: stats,
        database: dbStats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to get job stats');
      res.status(500).json({
        error: {
          code: 'STATS_ERROR',
          message: 'Failed to retrieve job statistics',
        },
      });
    }
  }

  async retryJob(req: Request, res: Response): Promise<void> {
    const { jobId } = req.params;

    try {
      // Get the job details first
      const job = await this.jobQueue.getJobById(jobId);

      if (!job) {
        res.status(404).json({
          error: {
            code: 'JOB_NOT_FOUND',
            message: 'Job not found',
          },
        });
        return;
      }

      // Retry the job
      await this.jobQueue.retryJob(jobId);

      // Update database status back to pending
      if (job.data?.sha256Hash) {
        await this.repository.updateBySha256Hash(job.data.sha256Hash, {
          status: 'awaiting_review',
          failed_at: null,
          failure_reason: null,
        });
      }

      res.json({
        message: 'Job requeued successfully',
        jobId,
      });
    } catch (error) {
      logger.error({ err: error, jobId }, 'Failed to retry job');
      res.status(500).json({
        error: {
          code: 'RETRY_ERROR',
          message: 'Failed to retry job',
        },
      });
    }
  }

  async getFailedJobs(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;

      const failedJobs = await this.repository.getFailedRecords(limit, offset);

      res.json({
        jobs: failedJobs,
        limit,
        offset,
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to get failed jobs');
      res.status(500).json({
        error: {
          code: 'FAILED_JOBS_ERROR',
          message: 'Failed to retrieve failed jobs',
        },
      });
    }
  }

  async getJobDetails(req: Request, res: Response): Promise<void> {
    const { jobId } = req.params;

    try {
      const job = await this.jobQueue.getJobById(jobId);

      if (!job) {
        res.status(404).json({
          error: {
            code: 'JOB_NOT_FOUND',
            message: 'Job not found',
          },
        });
        return;
      }

      res.json(job);
    } catch (error) {
      logger.error({ err: error, jobId }, 'Failed to get job details');
      res.status(500).json({
        error: {
          code: 'JOB_DETAILS_ERROR',
          message: 'Failed to retrieve job details',
        },
      });
    }
  }
}
