// Knexfile is used for migrations only

import type { Knex } from 'knex';
import dotenv from 'dotenv';

// app config not available when migrations are run by cli
dotenv.config();

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
