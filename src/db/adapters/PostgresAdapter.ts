import knex, { Knex } from 'knex';
import { logger } from '../../utils/logger.js';

export class PostgresAdapter {
  private knex: Knex;
  private connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;

    this.knex = knex({
      client: 'pg',
      connection: {
        connectionString: this.connectionString,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      },
      pool: {
        min: 2,
        max: 10,
      },
    });
  }

  getKnex(): Knex {
    return this.knex;
  }

  async initialize(): Promise<void> {
    // Test the connection
    try {
      await this.knex.raw('SELECT 1');
      logger.debug('PostgreSQL connection established');
      // Table creation is now handled by migrations
    } catch (error) {
      logger.error({ err: error }, 'Failed to connect to PostgreSQL');
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.knex.destroy();
  }

  async transaction<T>(callback: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return await this.knex.transaction(callback);
  }
}
