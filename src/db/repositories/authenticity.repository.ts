import { Knex } from 'knex';
import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import {
  AuthenticityRecord,
  CreateAuthenticityRecordInput,
  ExistingImageResult,
} from '../types.js';
import { Errors } from '../../utils/errors.js';

export class AuthenticityRepository {
  private adapter: PostgresAdapter;

  constructor(adapter: PostgresAdapter) {
    this.adapter = adapter;
  }

  /**
   * Insert a new pending authenticity record
   */
  async insertPendingRecord(record: CreateAuthenticityRecordInput): Promise<void> {
    try {
      await this.adapter.createRecord({
        sha256_hash: record.sha256Hash,
        token_owner_address: record.tokenOwnerAddress,
        token_owner_private_key: record.tokenOwnerPrivate,
        creator_public_key: record.creatorPublicKey,
        signature: record.signature,
        status: 'pending',
        transaction_id: null,
      });
    } catch (error) {
      // Handle unique constraint violations
      if (error instanceof Error && 'code' in error) {
        const dbError = error as Error & { code: string };
        if (dbError.code === '23505') {
          // PostgreSQL unique violation
          throw Errors.conflict('Record with this SHA256 hash already exists');
        }
      }
      throw error;
    }
  }

  /**
   * Check if an image already exists in the database
   */
  async checkExistingImage(sha256Hash: string): Promise<ExistingImageResult> {
    const record = await this.adapter.getRecordByHash(sha256Hash);

    if (!record) {
      return { exists: false };
    }

    return {
      exists: true,
      tokenOwnerAddress: record.token_owner_address,
      status: record.status,
    };
  }

  /**
   * Get a complete record by SHA256 hash
   */
  async getRecordByHash(sha256Hash: string): Promise<AuthenticityRecord | null> {
    return await this.adapter.getRecordByHash(sha256Hash);
  }

  /**
   * Get status information for a record
   */
  async getRecordStatus(sha256Hash: string): Promise<{
    status: string;
    tokenOwnerAddress?: string;
    transactionId?: string;
  } | null> {
    const record = await this.adapter.getRecordByHash(sha256Hash);

    if (!record) {
      return null;
    }

    return {
      status: record.status,
      tokenOwnerAddress: record.token_owner_address,
      transactionId: record.transaction_id || undefined,
    };
  }

  /**
   * Update a record with arbitrary fields
   */
  async updateRecord(sha256Hash: string, updates: Partial<AuthenticityRecord>): Promise<void> {
    await this.adapter.updateRecord(sha256Hash, updates);
  }

  /**
   * Delete a record by hash (for retry scenarios)
   */
  async deleteRecord(sha256Hash: string): Promise<boolean> {
    try {
      await this.adapter.deleteRecord(sha256Hash);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(callback: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return await this.adapter.transaction(callback);
  }

  /**
   * Get counts of records by status
   */
  async getStatusCounts(): Promise<Record<string, number>> {
    return await this.adapter.getStatusCounts();
  }

  /**
   * Get failed records with pagination
   */
  async getFailedRecords(limit: number, offset: number): Promise<AuthenticityRecord[]> {
    return await this.adapter.getFailedRecords(limit, offset);
  }
}
