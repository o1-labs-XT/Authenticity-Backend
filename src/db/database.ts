import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface DatabaseConfig {
  path: string;
  maxConnections?: number;
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
    console.log('Running database migrations...');

    // Create migrations table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get list of migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    // Check which migrations have been applied
    const appliedMigrations = this.db
      .prepare('SELECT name FROM migrations')
      .all()
      .map((row: any) => row.name);

    // Apply pending migrations
    for (const migrationFile of migrationFiles) {
      if (!appliedMigrations.includes(migrationFile)) {
        console.log(`Applying migration: ${migrationFile}`);
        
        const migrationPath = path.join(migrationsDir, migrationFile);
        const migration = fs.readFileSync(migrationPath, 'utf-8');

        // Execute migration in a transaction
        this.db.transaction(() => {
          this.db.exec(migration);
          this.db
            .prepare('INSERT INTO migrations (name) VALUES (?)')
            .run(migrationFile);
        })();

        console.log(`Migration ${migrationFile} applied successfully`);
      }
    }

    console.log('All migrations completed');
  }

  getDb(): Database.Database {
    return this.db;
  }

  /**
   * Execute a function within a transaction
   */
  transaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  /**
   * Prepare a statement for repeated execution
   */
  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  /**
   * Close the database connection
   */
  close(): void {
    console.log('Closing database connection...');
    this.db.close();
  }

}