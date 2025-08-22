import { DatabaseAdapter } from './adapters/DatabaseAdapter.js';
import { PostgresAdapter } from './adapters/PostgresAdapter.js';

export interface DatabaseConfig {
  connectionString: string;
}

export class DatabaseConnection {
  private adapter: DatabaseAdapter;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    
    // PostgreSQL is the only supported database
    this.adapter = new PostgresAdapter(config.connectionString);
    console.log('Using PostgreSQL database');
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

export function getDatabaseConnection(config: DatabaseConfig): DatabaseConnection {
  if (!dbConnection) {
    dbConnection = new DatabaseConnection(config);
  }
  return dbConnection;
}

export async function closeDatabaseConnection(): Promise<void> {
  if (dbConnection) {
    await dbConnection.close();
    dbConnection = null;
  }
}