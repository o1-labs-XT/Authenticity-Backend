import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface DatabaseConfig {
  path: string;
  busyTimeout?: number;
  walMode?: boolean;
  verbose?: boolean;
}

export class DatabaseConnection {
  private db: Database.Database;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig | string) {
    if (typeof config === 'string') {
      this.config = { path: config };
    } else {
      this.config = config;
    }

    // Ensure directory exists
    const dir = path.dirname(this.config.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize database connection
    this.db = new Database(this.config.path, {
      verbose: this.config.verbose ? console.log : undefined,
      fileMustExist: false,
    });

    // Configure database for better performance and concurrency
    this.configurePragmas();
    
    // Run migrations
    this.runMigrations();
  }

  private configurePragmas(): void {
    // Enable WAL mode for better concurrency
    if (this.config.walMode !== false) {
      this.db.pragma('journal_mode = WAL');
    }

    // Set busy timeout (default 5 seconds)
    const busyTimeout = this.config.busyTimeout || 5000;
    this.db.pragma(`busy_timeout = ${busyTimeout}`);

    // Other performance optimizations
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('temp_store = MEMORY');
  }

  private runMigrations(): void {
    console.log('Initializing database schema...');

    // Create the complete schema in a single transaction
    this.db.transaction(() => {
      // Main table for authenticity records with all columns
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS authenticity_records (
          sha256_hash TEXT PRIMARY KEY,
          token_owner_address TEXT NOT NULL,
          token_owner_private_key TEXT,
          creator_public_key TEXT NOT NULL,
          creator_private_key TEXT,
          signature TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'verified', 'failed')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          verified_at TIMESTAMP,
          transaction_id TEXT,
          error_message TEXT,
          proof_data TEXT  -- JSON serialized proof data
        );
        
        -- Indexes for performance
        CREATE INDEX IF NOT EXISTS idx_status ON authenticity_records(status);
        CREATE INDEX IF NOT EXISTS idx_token_owner ON authenticity_records(token_owner_address);
        CREATE INDEX IF NOT EXISTS idx_created_at ON authenticity_records(created_at);
      `);
    })();

    console.log('Database schema initialized successfully');
  }

  getDb(): Database.Database {
    return this.db;
  }

  /**
   * Close the database connection
   */
  close(): void {
    console.log('Closing database connection...');
    this.db.close();
  }

}
