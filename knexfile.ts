import type { Knex } from 'knex';
import dotenv from 'dotenv';

dotenv.config();

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      // Disable SSL for local development
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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
  }
};

export default config;
