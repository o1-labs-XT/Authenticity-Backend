import { Request, Response, NextFunction } from 'express';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import { Challenge } from '../db/types/touchgrass.types.js';
import { Errors } from '../utils/errors.js';

export interface ChallengeResponse {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  participantCount: number;
  chainCount: number;
}

export class ChallengesHandler {
  constructor(private readonly challengesRepo: ChallengesRepository) {}

  private toResponse(challenge: Challenge): ChallengeResponse {
    return {
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      startTime: new Date(challenge.start_time),
      endTime: new Date(challenge.end_time),
      participantCount: challenge.participant_count,
      chainCount: challenge.chain_count,
    };
  }

  async getCurrentChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const challenge = await this.challengesRepo.findCurrent();

      if (!challenge) {
        throw Errors.notFound('Challenge');
      }

      res.json(this.toResponse(challenge));
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

      if (!title) throw Errors.badRequest('title is required', 'title');
      if (!description) throw Errors.badRequest('description is required', 'description');
      if (!startTime) throw Errors.badRequest('startTime is required', 'startTime');
      if (!endTime) throw Errors.badRequest('endTime is required', 'endTime');

      const challenge = await this.challengesRepo.create({
        title,
        description,
        start_time: new Date(startTime),
        end_time: new Date(endTime),
      });

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
