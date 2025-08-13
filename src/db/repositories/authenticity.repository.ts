import Database from 'better-sqlite3';
import {
  AuthenticityRecord,
  CreateAuthenticityRecordInput,
  ExistingImageResult,
  StatusUpdate,
} from '../../types';

export class AuthenticityRepository {
  private db: Database.Database;
  
  // Prepared statements for better performance
  private insertStmt!: Database.Statement;
  private checkExistingStmt!: Database.Statement;
  private updateStatusStmt!: Database.Statement;
  private getByHashStmt!: Database.Statement;
  private getStatusStmt!: Database.Statement;
  private deleteFailedStmt!: Database.Statement;
  private deleteRecordStmt!: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.prepareStatements();
  }

  private prepareStatements(): void {
    // Prepare all statements at initialization for better performance
    this.insertStmt = this.db.prepare(`
      INSERT INTO authenticity_records 
      (sha256_hash, token_owner_address, creator_public_key, signature, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);

    this.checkExistingStmt = this.db.prepare(`
      SELECT token_owner_address, status 
      FROM authenticity_records 
      WHERE sha256_hash = ?
    `);

    this.updateStatusStmt = this.db.prepare(`
      UPDATE authenticity_records 
      SET status = ?, 
          verified_at = CASE WHEN ? = 'verified' THEN datetime('now') ELSE verified_at END,
          transaction_id = COALESCE(?, transaction_id),
          error_message = COALESCE(?, error_message),
          proof_data = COALESCE(?, proof_data)
      WHERE sha256_hash = ?
    `);

    this.getByHashStmt = this.db.prepare(`
      SELECT * FROM authenticity_records WHERE sha256_hash = ?
    `);

    this.getStatusStmt = this.db.prepare(`
      SELECT status, token_owner_address, transaction_id, error_message
      FROM authenticity_records 
      WHERE sha256_hash = ?
    `);

    this.deleteFailedStmt = this.db.prepare(`
      DELETE FROM authenticity_records 
      WHERE sha256_hash = ? AND status = 'failed'
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
  async updateRecordStatus(
    sha256Hash: string,
    update: StatusUpdate
  ): Promise<void> {
    const result = this.updateStatusStmt.run(
      update.status,
      update.status, // Used in CASE statement
      update.transactionId || null,
      update.errorMessage || null,
      update.proofData ? JSON.stringify(update.proofData) : null,
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
    errorMessage?: string;
  } | null> {
    const result = this.getStatusStmt.get(sha256Hash) as any;
    
    if (!result) {
      return null;
    }

    return {
      status: result.status,
      tokenOwnerAddress: result.token_owner_address,
      transactionId: result.transaction_id,
      errorMessage: result.error_message,
    };
  }

  /**
   * Delete a failed record (for retry scenarios)
   */
  async deleteFailedRecord(sha256Hash: string): Promise<boolean> {
    const result = this.deleteFailedStmt.run(sha256Hash);
    return result.changes > 0;
  }

  /**
   * Delete any record by hash (use with caution)
   */
  async deleteRecord(sha256Hash: string): Promise<boolean> {
    const result = this.deleteRecordStmt.run(sha256Hash);
    return result.changes > 0;
  }

  /**
   * Get all pending records
   */
  async getPendingRecords(limit: number = 10): Promise<AuthenticityRecord[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM authenticity_records 
      WHERE status = 'pending' 
      ORDER BY created_at ASC 
      LIMIT ?
    `);

    return stmt.all(limit) as AuthenticityRecord[];
  }

  /**
   * Get statistics about records
   */
  async getStatistics(): Promise<{
    total: number;
    pending: number;
    verified: number;
    failed: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM authenticity_records
    `);

    const result = stmt.get() as any;

    return {
      total: result.total || 0,
      pending: result.pending || 0,
      verified: result.verified || 0,
      failed: result.failed || 0,
    };
  }

  /**
   * Clean up old failed records
   */
  async cleanupOldFailedRecords(daysOld: number = 7): Promise<number> {
    const stmt = this.db.prepare(`
      DELETE FROM authenticity_records 
      WHERE status = 'failed' 
        AND created_at < datetime('now', '-' || ? || ' days')
    `);

    const result = stmt.run(daysOld);
    return result.changes;
  }

  /**
   * Execute a custom query (for complex operations)
   */
  async executeQuery<T>(sql: string, params: any[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  /**
   * Execute a transaction (note: better-sqlite3 transactions are synchronous)
   */
  transaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }
}