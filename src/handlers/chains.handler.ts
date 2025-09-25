import { Request, Response, NextFunction } from 'express';
import { ChainsRepository } from '../db/repositories/chains.repository.js';
import { Chain } from '../db/types/touchgrass.types.js';
import { Errors } from '../utils/errors.js';

export interface ChainResponse {
  id: string;
  name: string;
  challengeId: string;
  length: number;
  createdAt: Date;
  lastActivityAt: Date;
}

export class ChainsHandler {
  constructor(private readonly chainsRepo: ChainsRepository) {}

  private toResponse(chain: Chain): ChainResponse {
    return {
      id: chain.id,
      name: chain.name,
      challengeId: chain.challenge_id,
      length: chain.length,
      createdAt: new Date(chain.created_at),
      lastActivityAt: new Date(chain.last_activity_at),
    };
  }

  async getChain(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const chain = await this.chainsRepo.findById(id);
      if (!chain) {
        throw Errors.notFound('Chain');
      }

      res.json(this.toResponse(chain));
    } catch (error) {
      next(error);
    }
  }

  async getChains(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { challengeId } = req.query;

      let chains: Chain[];

      if (challengeId && typeof challengeId === 'string') {
        // Get chains for specific challenge
        chains = await this.chainsRepo.findByChallengeId(challengeId);
      } else {
        // Get all chains
        chains = await this.chainsRepo.findAll();
      }

      res.json(chains.map((c) => this.toResponse(c)));
    } catch (error) {
      next(error);
    }
  }
}
