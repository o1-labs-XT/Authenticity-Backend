import { Request, Response, NextFunction } from 'express';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import { Challenge } from '../db/types/touchgrass.types.js';
import { Errors } from '../utils/errors.js';
import { JobQueueService } from '../services/queue/jobQueue.service.js';
import { logger } from '../utils/logger.js';

export interface ChallengeResponse {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  participantCount: number;
  chainCount: number;

  // zkApp deployment fields
  zkAppAddress?: string;
  deploymentStatus: 'pending_deployment' | 'deploying' | 'active' | 'deployment_failed';
  transactionId?: string;
  failureReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

export class ChallengesHandler {
  constructor(
    private readonly challengesRepo: ChallengesRepository,
    private readonly jobQueue: JobQueueService
  ) {}

  private toResponse(challenge: Challenge): ChallengeResponse {
    return {
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      startTime: new Date(challenge.start_time),
      endTime: new Date(challenge.end_time),
      participantCount: challenge.participant_count,
      chainCount: challenge.chain_count,
      zkAppAddress: challenge.zkapp_address || undefined,
      deploymentStatus: challenge.deployment_status,
      transactionId: challenge.transaction_id || undefined,
      failureReason: challenge.failure_reason || undefined,

      createdAt: new Date(challenge.created_at),
      updatedAt: new Date(challenge.updated_at),
    };
  }

  async getActiveChallenges(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const challenges = await this.challengesRepo.findActive();

      // Return array of active challenges (could be empty)
      res.json(challenges.map((c) => this.toResponse(c)));
    } catch (error) {
      next(error);
    }
  }

  async getAllChallenges(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const challenges = await this.challengesRepo.findAll();
      res.json(challenges.map((c) => this.toResponse(c)));
    } catch (error) {
      next(error);
    }
  }

  async getChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const challenge = await this.challengesRepo.findById(id);
      if (!challenge) {
        throw Errors.notFound('Challenge');
      }

      res.json(this.toResponse(challenge));
    } catch (error) {
      next(error);
    }
  }

  async createChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { title, description, startTime, endTime } = req.body;

      // Validation (existing)
      if (!title) throw Errors.badRequest('title is required', 'title');
      if (!description) throw Errors.badRequest('description is required', 'description');
      if (!startTime) throw Errors.badRequest('startTime is required', 'startTime');
      if (!endTime) throw Errors.badRequest('endTime is required', 'endTime');

      const start = new Date(startTime);
      const end = new Date(endTime);

      if (end <= start) {
        throw Errors.badRequest('endTime must be after startTime');
      }

      // Create challenge record with pending deployment status
      const challenge = await this.challengesRepo.create({
        title,
        description,
        start_time: start,
        end_time: end,
      });

      logger.info({ challengeId: challenge.id }, 'Challenge created, enqueueing deployment');

      const jobId = await this.jobQueue.enqueueContractDeployment({
        challengeId: challenge.id,
        correlationId: (req as Request & { correlationId: string }).correlationId,
      });

      logger.info({ challengeId: challenge.id, jobId }, 'Contract deployment job enqueued');

      // Return challenge with pending deployment status
      res.status(201).json(this.toResponse(challenge));
    } catch (error) {
      next(error);
    }
  }

  async deleteChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const deleted = await this.challengesRepo.delete(id);
      if (!deleted) {
        throw Errors.notFound('Challenge');
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
