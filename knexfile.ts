import type { Knex } from 'knex';
import dotenv from 'dotenv';

dotenv.config();

const config: { [key: string]: Knex.Config } = {
  development: {
    // Use PostgreSQL if DATABASE_URL is set, otherwise SQLite
    client: process.env.DATABASE_URL ? 'pg' : 'sqlite3',
    connection: process.env.DATABASE_URL ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    } : {
      filename: process.env.DATABASE_PATH || './data/provenance.db'
    },
    pool: process.env.DATABASE_URL ? { min: 2, max: 10 } : undefined,
    migrations: {
      directory: './migrations',
      extension: 'ts'
    },
    seeds: {
      directory: './seeds'
    },
    useNullAsDefault: !process.env.DATABASE_URL // Only needed for SQLite
  },

  production: {
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: './migrations',
      extension: 'ts'
    },
    seeds: {
      directory: './seeds'
    }
  },

  test: {
    client: 'sqlite3',
    connection: ':memory:',
    migrations: {
      directory: './migrations',
      extension: 'ts'
    },
    seeds: {
      directory: './seeds'
    },
    useNullAsDefault: true
  }
};

export default config;