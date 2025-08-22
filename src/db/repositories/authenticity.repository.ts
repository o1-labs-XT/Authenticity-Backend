import { DatabaseAdapter } from '../adapters/DatabaseAdapter.js';
import {
  AuthenticityRecord,
  CreateAuthenticityRecordInput,
  ExistingImageResult,
  StatusUpdate,
} from '../types.js';

export class AuthenticityRepository {
  private adapter: DatabaseAdapter;

  constructor(adapter: DatabaseAdapter) {
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
    } catch (error: any) {
      // Handle unique constraint violations
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === '23505') {
        throw new Error('Record with this SHA256 hash already exists');
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
   * Update the status of an authenticity record
   */
  async updateRecordStatus(sha256Hash: string, update: StatusUpdate): Promise<void> {
    const record = await this.adapter.getRecordByHash(sha256Hash);
    
    if (!record) {
      throw new Error(`No record found with hash: ${sha256Hash}`);
    }

    const updates: Partial<AuthenticityRecord> = {};
    
    if (update.status) {
      updates.status = update.status;
    }
    
    if (update.transactionId) {
      updates.transaction_id = update.transactionId;
    }

    await this.adapter.updateRecord(sha256Hash, updates);
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
  async transaction<T>(callback: (trx: any) => Promise<T>): Promise<T> {
    return await this.adapter.transaction(callback);
  }
}