import { Request, Response, NextFunction } from 'express';
import { PublicKey } from 'o1js';
import { LikesRepository } from '../db/repositories/likes.repository.js';
import { UsersRepository } from '../db/repositories/users.repository.js';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { Like } from '../db/types/touchgrass.types.js';
import { Errors } from '../utils/errors.js';

export interface LikeResponse {
  id: string;
  submissionId: string;
  walletAddress: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LikeCountResponse {
  submissionId: string;
  count: number;
}

export class LikesHandler {
  constructor(
    private readonly likesRepo: LikesRepository,
    private readonly usersRepo: UsersRepository,
    private readonly submissionsRepo: SubmissionsRepository
  ) {}

  private toResponse(like: Like): LikeResponse {
    return {
      id: like.id,
      submissionId: like.submission_id,
      walletAddress: like.wallet_address,
      createdAt: new Date(like.created_at),
      updatedAt: new Date(like.updated_at),
    };
  }

  async createLike(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { submissionId } = req.params;
      const { walletAddress } = req.body;

      // Validate required fields
      if (!walletAddress) {
        throw Errors.badRequest('walletAddress is required', 'walletAddress');
      }

      // Validate wallet address format
      try {
        PublicKey.fromBase58(walletAddress);
      } catch {
        throw Errors.badRequest('Invalid wallet address format', 'walletAddress');
      }

      // Check if submission exists
      const submission = await this.submissionsRepo.findById(submissionId);
      if (!submission) {
        throw Errors.notFound('Submission');
      }

      // Ensure user exists (auto-create if needed, like submission handler does)
      await this.usersRepo.findOrCreate(walletAddress);

      // Create the like
      const like = await this.likesRepo.create(submissionId, walletAddress);

      res.status(201).json(this.toResponse(like));
    } catch (error) {
      next(error);
    }
  }

  async deleteLike(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { submissionId, walletAddress } = req.params;

      const deleted = await this.likesRepo.delete(submissionId, walletAddress);
      if (!deleted) {
        throw Errors.notFound('Like not found');
      }

      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  async getLikes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { submissionId } = req.params;

      // Check if submission exists
      const submission = await this.submissionsRepo.findById(submissionId);
      if (!submission) {
        throw Errors.notFound('Submission');
      }

      const likes = await this.likesRepo.findBySubmission(submissionId);

      res.json(likes.map((like) => this.toResponse(like)));
    } catch (error) {
      next(error);
    }
  }

  async getLikeCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { submissionId } = req.params;

      // Check if submission exists
      const submission = await this.submissionsRepo.findById(submissionId);
      if (!submission) {
        throw Errors.notFound('Submission');
      }

      const count = await this.likesRepo.countBySubmission(submissionId);

      res.json({
        submissionId,
        count,
      });
    } catch (error) {
      next(error);
    }
  }
}
