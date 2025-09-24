import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { Challenge } from '../types/touchgrass.types.js';

export class ChallengesRepository {
  constructor(private readonly db: PostgresAdapter) {}

  async create(data: {
    title: string;
    description: string;
    start_time: Date;
    end_time: Date;
  }): Promise<Challenge> {
    const [challenge] = await this.db
      .getKnex()('challenges')
      .insert({
        ...data,
        participant_count: 0,
        chain_count: 1, // MVP: Always 1 chain per challenge
      })
      .returning('*');

    // TODO: Automatically create a default chain for this challenge
    // This should be done in a transaction with the challenge creation
    // For MVP: Each challenge has exactly one chain, created automatically

    return challenge;
  }

  async findCurrent(): Promise<Challenge | null> {
    const now = new Date();
    const result = await this.db
      .getKnex()('challenges')
      .where('start_time', '<=', now)
      .where('end_time', '>', now)
      .orderBy('start_time', 'desc')
      .first();

    return result || null;
  }

  async findById(id: string): Promise<Challenge | null> {
    const result = await this.db.getKnex()('challenges').where('id', id).first();

    return result || null;
  }

  async findAll(): Promise<Challenge[]> {
    return this.db.getKnex()('challenges').orderBy('start_time', 'desc');
  }

  // todo - call when a submission is created
  async incrementParticipantCount(id: string): Promise<void> {
    await this.db.getKnex()('challenges').where('id', id).increment('participant_count', 1);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db.getKnex()('challenges').where('id', id).delete();

    return deleted > 0;
  }
}
