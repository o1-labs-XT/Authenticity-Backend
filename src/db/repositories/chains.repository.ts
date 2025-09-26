import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { Chain } from '../types/touchgrass.types.js';

export class ChainsRepository {
  constructor(private readonly db: PostgresAdapter) {}

  async findById(id: string): Promise<Chain | null> {
    const result = await this.db.getKnex()('chains').where('id', id).first();

    return result || null;
  }

  async findAll(): Promise<Chain[]> {
    return this.db.getKnex()('chains').orderBy('created_at', 'asc');
  }

  async findByChallengeId(challengeId: string): Promise<Chain[]> {
    return this.db
      .getKnex()('chains')
      .where('challenge_id', challengeId)
      .orderBy('created_at', 'asc');
  }

  async create(challengeId: string, name: string = 'Default'): Promise<Chain> {
    const [chain] = await this.db
      .getKnex()('chains')
      .insert({
        challenge_id: challengeId,
        name,
        length: 0,
      })
      .returning('*');

    return chain;
  }
}
