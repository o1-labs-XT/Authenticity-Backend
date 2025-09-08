import { PostgresAdapter } from './adapters/PostgresAdapter.js';
import { logger } from '../utils/logger.js';

export interface DatabaseConfig {
  connectionString: string;
}

export class DatabaseConnection {
  private adapter: PostgresAdapter;

  constructor(config: DatabaseConfig) {
    this.adapter = new PostgresAdapter(config.connectionString);
  }

  /**
   * Initialize the database connection and create tables
   */
  async initialize(): Promise<void> {
    await this.adapter.initialize();
    logger.debug('Database initialized successfully');
  }

  /**
   * Get the database adapter
   */
  getAdapter(): PostgresAdapter {
    return this.adapter;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    logger.debug('Closing database connection...');
    await this.adapter.close();
  }
}
