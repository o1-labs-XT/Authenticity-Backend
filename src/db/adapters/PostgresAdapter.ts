import knex, { Knex } from 'knex';
import { DatabaseAdapter, AuthenticityRecord } from './DatabaseAdapter.js';

export class PostgresAdapter implements DatabaseAdapter {
  private knex: Knex;
  private connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    
    this.knex = knex({
      client: 'pg',
      connection: {
        connectionString: this.connectionString,
        ssl: process.env.NODE_ENV === 'production' 
          ? { rejectUnauthorized: false }
          : false
      },
      pool: {
        min: 2,
        max: 10
      }
    });
  }

  getKnex(): Knex {
    return this.knex;
  }

  async initialize(): Promise<void> {
    // Test the connection
    try {
      await this.knex.raw('SELECT 1');
      console.log('PostgreSQL database connection established');
      // Table creation is now handled by migrations
    } catch (error) {
      console.error('Failed to connect to PostgreSQL:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.knex.destroy();
  }

  async createTable(): Promise<void> {
    const exists = await this.knex.schema.hasTable('authenticity_records');
    
    if (!exists) {
      await this.knex.schema.createTable('authenticity_records', (table) => {
        table.string('sha256_hash').primary();
        table.string('token_owner_address').notNullable();
        table.string('token_owner_private_key').nullable();
        table.string('creator_public_key').notNullable();
        table.string('signature').notNullable();
        table.string('status').notNullable().checkIn(['pending', 'verified']).index();
        table.timestamp('created_at').notNullable().defaultTo(this.knex.fn.now());
        table.timestamp('verified_at').nullable();
        table.string('transaction_id').nullable();
        table.index('token_owner_address');
        table.index('created_at');
      });
      console.log('Created authenticity_records table in PostgreSQL');
    }
  }

  async getAllRecords(): Promise<AuthenticityRecord[]> {
    return await this.knex<AuthenticityRecord>('authenticity_records')
      .select('*')
      .orderBy('created_at', 'desc');
  }

  async getRecordByHash(sha256Hash: string): Promise<AuthenticityRecord | null> {
    const record = await this.knex<AuthenticityRecord>('authenticity_records')
      .where('sha256_hash', sha256Hash)
      .first();
    
    return record || null;
  }

  async getRecordsByStatus(status: 'pending' | 'verified'): Promise<AuthenticityRecord[]> {
    return await this.knex<AuthenticityRecord>('authenticity_records')
      .where('status', status)
      .orderBy('created_at', 'desc');
  }

  async getRecordsByTokenOwner(tokenOwner: string): Promise<AuthenticityRecord | null> {
    const record = await this.knex<AuthenticityRecord>('authenticity_records')
      .where('token_owner_address', tokenOwner)
      .first();
    
    return record || null;
  }

  async createRecord(record: Omit<AuthenticityRecord, 'created_at' | 'verified_at'>): Promise<void> {
    const now = new Date().toISOString();
    await this.knex<AuthenticityRecord>('authenticity_records').insert({
      ...record,
      created_at: now
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
}