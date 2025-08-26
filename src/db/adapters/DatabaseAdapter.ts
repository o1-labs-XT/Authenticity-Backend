import { Knex } from 'knex';

export interface AuthenticityRecord {
  sha256_hash: string;
  token_owner_address: string;
  token_owner_private_key?: string | null;
  creator_public_key: string;
  signature: string;
  status: 'pending' | 'processing' | 'verified' | 'failed';
  created_at: string;
  verified_at?: string | null;
  transaction_id?: string | null;
  job_id?: string | null;
  processing_started_at?: string | null;
  failed_at?: string | null;
  failure_reason?: string | null;
  retry_count?: number;
  image_data?: Buffer | null;
  original_filename?: string | null;
  file_size?: number | null;
}

export interface DatabaseAdapter {
  /**
   * Get the underlying Knex instance for this adapter
   */
  getKnex(): Knex;

  /**
   * Initialize the database connection
   */
  initialize(): Promise<void>;

  /**
   * Close the database connection
   */
  close(): Promise<void>;

  /**
   * Create the authenticity_records table if it doesn't exist
   */
  createTable(): Promise<void>;

  /**
   * Get all records from the database
   */
  getAllRecords(): Promise<AuthenticityRecord[]>;

  /**
   * Get a record by SHA256 hash
   */
  getRecordByHash(sha256Hash: string): Promise<AuthenticityRecord | null>;

  /**
   * Get records by status
   */
  getRecordsByStatus(status: 'pending' | 'verified'): Promise<AuthenticityRecord[]>;

  /**
   * Get records by token owner
   */
  getRecordsByTokenOwner(tokenOwner: string): Promise<AuthenticityRecord | null>;

  /**
   * Create a new record
   */
  createRecord(record: Omit<AuthenticityRecord, 'created_at' | 'verified_at'>): Promise<void>;

  /**
   * Update a record
   */
  updateRecord(sha256Hash: string, updates: Partial<AuthenticityRecord>): Promise<void>;

  /**
   * Delete a record
   */
  deleteRecord(sha256Hash: string): Promise<void>;

  /**
   * Execute a transaction
   */
  transaction<T>(callback: (trx: Knex.Transaction) => Promise<T>): Promise<T>;

  /**
   * Get counts of records by status
   */
  getStatusCounts(): Promise<Record<string, number>>;

  /**
   * Get failed records with pagination
   */
  getFailedRecords(limit: number, offset: number): Promise<AuthenticityRecord[]>;
}