import { PostgresAdapter } from './adapters/PostgresAdapter.js';

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
    console.log('Database initialized successfully');
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
    console.log('Closing database connection...');
    await this.adapter.close();
  }
}
