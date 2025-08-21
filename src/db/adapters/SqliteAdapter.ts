import knex, { Knex } from 'knex';
import { DatabaseAdapter, AuthenticityRecord } from './DatabaseAdapter.js';
import fs from 'fs';
import path from 'path';

export class SqliteAdapter implements DatabaseAdapter {
  private knex: Knex;
  private dbPath: string;

  constructor(dbPath: string = './data/provenance.db') {
    this.dbPath = dbPath;
    
    // Ensure the directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.knex = knex({
      client: 'sqlite3',
      connection: {
        filename: this.dbPath
      },
      useNullAsDefault: true,
      pool: {
        min: 1,
        max: 1
      }
    });
  }

  getKnex(): Knex {
    return this.knex;
  }

  async initialize(): Promise<void> {
    // SQLite doesn't need explicit initialization
    console.log(`SQLite database initialized at: ${this.dbPath}`);
    // Table creation is now handled by migrations
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
      console.log('Created authenticity_records table');
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