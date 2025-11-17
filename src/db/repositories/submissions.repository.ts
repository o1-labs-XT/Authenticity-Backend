import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { Submission } from '../types/touchgrass.types.js';
import { Knex } from 'knex';
import { Errors } from '../../utils/errors.js';

export interface TransactionInfo {
  hash: string;
  submittedHeight: number;
  sha256Hash: string;
}

export interface CreateSubmissionInput {
  sha256Hash: string;
  walletAddress: string; // User's wallet address (public key)
  signature: string;
  challengeId: string;
  chainId: string;
  storageKey: string;
  tagline?: string;
}

export class SubmissionsRepository {
  constructor(private readonly db: PostgresAdapter) {}

  async create(input: CreateSubmissionInput): Promise<Submission> {
    const knex = this.db.getKnex();

    try {
      const submission = await knex.transaction(async (trx: Knex.Transaction) => {
        // 1. Get next chain position
        const result = await trx('submissions')
          .where('chain_id', input.chainId)
          .max('chain_position as max_position')
          .first();
        const chainPosition = (result?.max_position || 0) + 1;

        // 2. Insert submission
        const [newSubmission] = await trx('submissions')
          .insert({
            sha256_hash: input.sha256Hash,
            wallet_address: input.walletAddress,
            signature: input.signature,
            challenge_id: input.challengeId,
            chain_id: input.chainId,
            storage_key: input.storageKey,
            tagline: input.tagline,
            chain_position: chainPosition,
            status: 'awaiting_review',
          })
          .returning('*');

        // 3. Update chain length and last_activity_at
        await trx('chains')
          .where('id', input.chainId)
          .increment('length', 1)
          .update({ last_activity_at: knex.fn.now() });

        // 4. Increment challenge participant count
        await trx('challenges').where('id', input.challengeId).increment('participant_count', 1);

        return newSubmission;
      });

      return submission;
    } catch (error) {
      // Handle unique constraint violations
      if (error instanceof Error && 'code' in error) {
        const dbError = error as Error & { code: string; constraint?: string };
        if (dbError.code === '23505') {
          // PostgreSQL unique violation
          if (dbError.constraint?.includes('sha256_hash')) {
            throw Errors.conflict('Image already submitted');
          }
        }
        // Foreign key violation
        if (dbError.code === '23503') {
          throw Errors.notFound('Chain or Challenge not found');
        }
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Submission | null> {
    const result = await this.db.getKnex()('submissions').where('id', id).first();
    return result || null;
  }

  async findAll(options?: {
    walletAddress?: string;
    chainId?: string;
    challengeId?: string;
    status?: string;
  }): Promise<Submission[]> {
    let query = this.db.getKnex()('submissions');

    if (options?.walletAddress) {
      query = query.where('wallet_address', options.walletAddress);
    }
    if (options?.chainId) {
      query = query.where('chain_id', options.chainId);
    }
    if (options?.challengeId) {
      query = query.where('challenge_id', options.challengeId);
    }
    if (options?.status) {
      query = query.where('status', options.status);
    }

    return query.orderBy('created_at', 'desc');
  }

  async update(id: string, updates: Partial<Submission>): Promise<Submission | null> {
    const knex = this.db.getKnex();
    const [updated] = await knex('submissions')
      .where('id', id)
      .update({
        ...updates,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    return updated || null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db.getKnex()('submissions').where('id', id).delete();
    return deleted > 0;
  }

  // todo: this is a duplicate, there should only be one update method
  async updateBySha256Hash(
    sha256Hash: string,
    updates: Partial<Submission>
  ): Promise<Submission | null> {
    const knex = this.db.getKnex();
    const [updated] = await knex('submissions')
      .where('sha256_hash', sha256Hash)
      .update({
        ...updates,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    return updated || null;
  }

  // todo: could we combine this with findall?
  async getRecentTransactionsForMonitoring(lookbackBlocks: number): Promise<TransactionInfo[]> {
    const results = await this.db
      .getKnex()('submissions')
      .select('transaction_id', 'transaction_submitted_block_height', 'sha256_hash')
      .whereNotNull('transaction_id')
      .whereNotNull('transaction_submitted_block_height')
      .orderBy('transaction_submitted_block_height', 'desc')
      .limit(lookbackBlocks * 10); // Get more records than blocks to ensure coverage

    return results
      .filter((result) => result.transaction_id && result.transaction_submitted_block_height)
      .map((result) => ({
        hash: result.transaction_id!,
        submittedHeight: result.transaction_submitted_block_height!,
        sha256Hash: result.sha256_hash,
      }));
  }

  /**
   * Get all active zkApp addresses from challenges
   * Used by blockchain monitoring worker to query multiple zkApps
   */
  async getActiveZkAppAddresses(): Promise<string[]> {
    const results = await this.db
      .getKnex()('challenges')
      .select('zkapp_address')
      .where('deployment_status', 'active')
      .whereNotNull('zkapp_address');

    return results.map((result) => result.zkapp_address).filter(Boolean);
  }
}
