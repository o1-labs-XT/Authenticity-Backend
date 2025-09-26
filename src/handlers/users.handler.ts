import { Request, Response, NextFunction } from 'express';
import { PublicKey } from 'o1js';
import { UsersRepository } from '../db/repositories/users.repository.js';
import { User } from '../db/types/touchgrass.types.js';
import { Errors } from '../utils/errors.js';

export interface UserResponse {
  walletAddress: string;
  createdAt: Date;
  updatedAt: Date;
}

export class UsersHandler {
  constructor(private readonly usersRepo: UsersRepository) {}

  private toResponse(user: User): UserResponse {
    return {
      walletAddress: user.wallet_address,
      createdAt: new Date(user.created_at),
      updatedAt: new Date(user.updated_at),
    };
  }

  async getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { walletAddress } = req.params;

      const user = await this.usersRepo.findByWalletAddress(walletAddress);
      if (!user) {
        throw Errors.notFound('User');
      }

      res.json(this.toResponse(user));
    } catch (error) {
      next(error);
    }
  }

  async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { walletAddress } = req.body;

      if (!walletAddress) {
        throw Errors.badRequest('walletAddress is required', 'walletAddress');
      }

      // Validate wallet address format
      try {
        PublicKey.fromBase58(walletAddress);
      } catch {
        throw Errors.badRequest('Invalid wallet address format', 'walletAddress');
      }

      const result = await this.usersRepo.findOrCreate(walletAddress);

      res.status(result.created ? 201 : 200).json(this.toResponse(result.user));
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    // TODO: admin-only
    try {
      const { walletAddress } = req.params;

      const deleted = await this.usersRepo.delete(walletAddress);
      if (!deleted) {
        throw Errors.notFound('User');
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
