import { DatabaseAdapter } from './adapters/DatabaseAdapter.js';
import { SqliteAdapter } from './adapters/SqliteAdapter.js';
import { PostgresAdapter } from './adapters/PostgresAdapter.js';

export interface DatabaseConfig {
  type?: 'sqlite' | 'postgres';
  connectionString?: string;
  path?: string;
  busyTimeout?: number;
  walMode?: boolean;
  verbose?: boolean;
}

export class DatabaseConnection {
  private adapter: DatabaseAdapter;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig | string) {
    if (typeof config === 'string') {
      // Legacy support for string path
      this.config = { type: 'sqlite', path: config };
    } else {
      this.config = config;
    }

    // Determine which adapter to use based on environment
    if (process.env.DATABASE_URL) {
      // Use PostgreSQL if DATABASE_URL is set
      this.adapter = new PostgresAdapter(process.env.DATABASE_URL);
      console.log('Using PostgreSQL database');
    } else if (this.config.type === 'postgres' && this.config.connectionString) {
      // Use PostgreSQL if explicitly configured
      this.adapter = new PostgresAdapter(this.config.connectionString);
      console.log('Using PostgreSQL database');
    } else {
      // Default to SQLite
      const dbPath = this.config.path || process.env.DATABASE_PATH || './data/provenance.db';
      this.adapter = new SqliteAdapter(dbPath);
      console.log('Using SQLite database');
    }
  }

  /**
   * Initialize the database connection and create tables
   */
  async initialize(): Promise<void> {
    await this.adapter.initialize();
    console.log('Database initialized successfully');
  }

  /**
   * Get the database adapter
   */
  getAdapter(): DatabaseAdapter {
    return this.adapter;
  }

  /**
   * Get the underlying Knex instance for direct queries
   */
  getDb() {
    return this.adapter.getKnex();
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    console.log('Closing database connection...');
    await this.adapter.close();
  }
}

// Create a singleton instance
let dbConnection: DatabaseConnection | null = null;

export function getDatabaseConnection(config?: DatabaseConfig | string): DatabaseConnection {
  if (!dbConnection) {
    dbConnection = new DatabaseConnection(config || {});
  }
  return dbConnection;
}

export async function closeDatabaseConnection(): Promise<void> {
  if (dbConnection) {
    await dbConnection.close();
    dbConnection = null;
  }
}