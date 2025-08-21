import Database from 'better-sqlite3';
import {
  AuthenticityRecord,
  CreateAuthenticityRecordInput,
  ExistingImageResult,
  StatusUpdate,
} from '../types.js';

export class AuthenticityRepository {
  private db: Database.Database;

  // Prepared statements for better performance
  private insertStmt!: Database.Statement;
  private checkExistingStmt!: Database.Statement;
  private updateStatusStmt!: Database.Statement;
  private getByHashStmt!: Database.Statement;
  private getStatusStmt!: Database.Statement;
  private deleteRecordStmt!: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.prepareStatements();
  }

  private prepareStatements(): void {
    // Prepare all statements at initialization for better performance
    this.insertStmt = this.db.prepare(`
      INSERT INTO authenticity_records 
      (sha256_hash, token_owner_address, token_owner_private_key, creator_public_key, signature, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `);

    this.checkExistingStmt = this.db.prepare(`
      SELECT token_owner_address, status 
      FROM authenticity_records 
      WHERE sha256_hash = ?
    `);

    this.updateStatusStmt = this.db.prepare(`
      UPDATE authenticity_records 
      SET status = COALESCE(?, status), 
          verified_at = CASE WHEN ? = 'verified' THEN datetime('now') ELSE verified_at END,
          transaction_id = COALESCE(?, transaction_id)
      WHERE sha256_hash = ?
    `);

    this.getByHashStmt = this.db.prepare(`
      SELECT * FROM authenticity_records WHERE sha256_hash = ?
    `);

    this.getStatusStmt = this.db.prepare(`
      SELECT status, token_owner_address, transaction_id
      FROM authenticity_records 
      WHERE sha256_hash = ?
    `);


    this.deleteRecordStmt = this.db.prepare(`
      DELETE FROM authenticity_records 
      WHERE sha256_hash = ?
    `);
  }

  /**
   * Insert a new pending authenticity record
   */
  async insertPendingRecord(record: CreateAuthenticityRecordInput): Promise<void> {
    try {
      this.insertStmt.run(
        record.sha256Hash,
        record.tokenOwnerAddress,
        record.tokenOwnerPrivate,
        record.creatorPublicKey,
        record.signature
      );
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new Error('Record with this SHA256 hash already exists');
      }
      throw error;
    }
  }

  /**
   * Check if an image already exists in the database
   */
  async checkExistingImage(sha256Hash: string): Promise<ExistingImageResult> {
    const result = this.checkExistingStmt.get(sha256Hash) as any;

    if (!result) {
      return { exists: false };
    }

    return {
      exists: true,
      tokenOwnerAddress: result.token_owner_address,
      status: result.status,
    };
  }

  /**
   * Update the status of an authenticity record
   */
  async updateRecordStatus(sha256Hash: string, update: StatusUpdate): Promise<void> {
    const result = this.updateStatusStmt.run(
      update.status || null,
      update.status || null, // Used in CASE statement
      update.transactionId || null,
      sha256Hash
    );

    if (result.changes === 0) {
      throw new Error(`No record found with hash: ${sha256Hash}`);
    }
  }

  /**
   * Get a complete record by SHA256 hash
   */
  async getRecordByHash(sha256Hash: string): Promise<AuthenticityRecord | null> {
    const record = this.getByHashStmt.get(sha256Hash) as AuthenticityRecord | undefined;
    return record || null;
  }

  /**
   * Get status information for a record
   */
  async getRecordStatus(sha256Hash: string): Promise<{
    status: string;
    tokenOwnerAddress?: string;
    transactionId?: string;
  } | null> {
    const result = this.getStatusStmt.get(sha256Hash) as any;

    if (!result) {
      return null;
    }

    return {
      status: result.status,
      tokenOwnerAddress: result.token_owner_address,
      transactionId: result.transaction_id,
    };
  }

  /**
   * Delete a record by hash (for retry scenarios)
   */
  async deleteRecord(sha256Hash: string): Promise<boolean> {
    const result = this.deleteRecordStmt.run(sha256Hash);
    return result.changes > 0;
  }
}
