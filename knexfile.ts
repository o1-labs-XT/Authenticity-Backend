// Knexfile is used for migrations only

import type { Knex } from 'knex';
import dotenv from 'dotenv';

// app config not available when migrations are run by cli
dotenv.config();

// Validate required DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('\n❌ DATABASE_URL environment variable is required for database operations.');
  console.error('   Please configure your .env file with DATABASE_URL.\n');
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';

const config: Knex.Config = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    // prod: enable SSL but allow self-signed certificates for cloud dbs
    // development: disable SSL
    ssl: isProduction ? { rejectUnauthorized: false } : false,
  },
  migrations: {
    directory: './migrations',
    extension: 'ts',
  },
};

// Knex CLI expects separate configs per environment
export default {
  development: config,
  production: config,
};
