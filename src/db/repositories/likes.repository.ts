import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { Like } from '../types/touchgrass.types.js';
import { Errors } from '../../utils/errors.js';

export class LikesRepository {
  constructor(private readonly db: PostgresAdapter) {}

  async create(submissionId: string, walletAddress: string): Promise<Like> {
    try {
      const [like] = await this.db
        .getKnex()('likes')
        .insert({
          submission_id: submissionId,
          wallet_address: walletAddress,
        })
        .returning('*');

      return like;
    } catch (error) {
      // Handle database constraint violations
      if (error instanceof Error && 'code' in error) {
        const dbError = error as Error & { code: string; constraint?: string };

        // Unique constraint violation (duplicate like)
        if (dbError.code === '23505') {
          throw Errors.conflict('You have already liked this submission');
        }

        // Foreign key violation (submission or user not found)
        if (dbError.code === '23503') {
          throw Errors.notFound('Submission or User not found');
        }
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Like | null> {
    const result = await this.db.getKnex()('likes').where('id', id).first();
    return result || null;
  }

  async findBySubmissionAndUser(submissionId: string, walletAddress: string): Promise<Like | null> {
    const result = await this.db
      .getKnex()('likes')
      .where({
        submission_id: submissionId,
        wallet_address: walletAddress,
      })
      .first();

    return result || null;
  }

  async findBySubmission(submissionId: string): Promise<Like[]> {
    const results = await this.db
      .getKnex()('likes')
      .where('submission_id', submissionId)
      .orderBy('created_at', 'desc');

    return results;
  }

  async countBySubmission(submissionId: string): Promise<number> {
    const result = await this.db
      .getKnex()('likes')
      .where('submission_id', submissionId)
      .count('* as count')
      .first();

    return parseInt(result?.count as string) || 0;
  }

  async delete(submissionId: string, walletAddress: string): Promise<boolean> {
    const deleted = await this.db
      .getKnex()('likes')
      .where({
        submission_id: submissionId,
        wallet_address: walletAddress,
      })
      .delete();

    return deleted > 0;
  }

  async existsBySubmissionAndUser(submissionId: string, walletAddress: string): Promise<boolean> {
    const result = await this.findBySubmissionAndUser(submissionId, walletAddress);
    return result !== null;
  }
}
