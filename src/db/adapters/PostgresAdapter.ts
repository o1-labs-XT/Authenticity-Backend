import knex, { Knex } from 'knex';
import { logger } from '../../utils/logger.js';
import { AuthenticityRecord } from '../types.js';
 
export class PostgresAdapter  {
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

  async getRecordByHash(sha256Hash: string): Promise<AuthenticityRecord | null> {
    const record = await this.knex<AuthenticityRecord>('authenticity_records')
      .where('sha256_hash', sha256Hash)
      .first();

    return record || null;
  }

  async createRecord(
    record: Omit<AuthenticityRecord, 'created_at' | 'verified_at'>
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.knex<AuthenticityRecord>('authenticity_records').insert({
      ...record,
      created_at: now,
    });
  }

  async updateRecord(sha256Hash: string, updates: Partial<AuthenticityRecord>): Promise<void> {
    // Handle verified_at timestamp when status changes to 'verified'
    const updateData = { ...updates };
    if (updates.status === 'verified' && !updates.verified_at) {
      updateData.verified_at = new Date().toISOString();
    }

    await this.knex<AuthenticityRecord>('authenticity_records')
      .where('sha256_hash', sha256Hash)
      .update(updateData);
  }

  async deleteRecord(sha256Hash: string): Promise<void> {
    await this.knex<AuthenticityRecord>('authenticity_records')
      .where('sha256_hash', sha256Hash)
      .delete();
  }

  async transaction<T>(callback: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return await this.knex.transaction(callback);
  }

  async getStatusCounts(): Promise<Record<string, number>> {
    const results = (await this.knex('authenticity_records')
      .select('status')
      .count('* as count')
      .groupBy('status')) as Array<{ status: string; count: string | number }>;

    const counts: Record<string, number> = {};
    for (const row of results) {
      counts[row.status] = parseInt(String(row.count), 10);
    }

    // Ensure all statuses are represented
    const statuses = ['pending', 'processing', 'verified', 'failed'];
    for (const status of statuses) {
      if (!counts[status]) {
        counts[status] = 0;
      }
    }

    return counts;
  }

  async getFailedRecords(limit: number, offset: number): Promise<AuthenticityRecord[]> {
    return await this.knex<AuthenticityRecord>('authenticity_records')
      .where('status', 'failed')
      .orderBy('failed_at', 'desc')
      .limit(limit)
      .offset(offset);
  }
}
