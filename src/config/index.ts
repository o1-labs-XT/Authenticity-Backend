import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Application configuration parsed and validated at startup
 */
export interface Config {
  // Server
  port: number;
  nodeEnv: 'development' | 'production' | 'test';

  // Database
  databaseUrl: string;

  // Mina Network
  minaNetwork: 'testnet' | 'mainnet';
  zkappAddress: string;
  feePayerPrivateKey: string;

  // API Configuration
  corsOrigin: string;
  uploadMaxSize: number; // in bytes

  // Optional configurations
  circuitCachePath?: string;

  // MinIO Storage
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  minioBucket: string;

  // Admin Authentication
  ADMIN_PASSWORD: string;

  // Archive Node Configuration
  archiveNodeEndpoint: string;
  minaNodeEndpoint: string;
  monitoringEnabled: boolean;
}

/**
 * Parse and validate environment variables
 * Throws an error if required variables are missing or invalid
 */
function parseConfig(): Config {
  const errors: string[] = [];

  // Helper to get required env var
  const getRequired = (key: string): string => {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      errors.push(`Missing required environment variable: ${key}`);
      return '';
    }
    return value;
  };

  // Helper to parse required number
  const getRequiredNumber = (key: string): number => {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      errors.push(`Missing required environment variable: ${key}`);
      return 0;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      errors.push(`Invalid number for ${key}: ${value}`);
      return 0;
    }
    return parsed;
  };

  // Parse NODE_ENV
  const nodeEnv = getRequired('NODE_ENV');
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    errors.push(`Invalid NODE_ENV: ${nodeEnv}. Must be development, production, or test`);
  }

  // Parse MINA_NETWORK
  const minaNetwork = getRequired('MINA_NETWORK');
  if (!['testnet', 'mainnet'].includes(minaNetwork)) {
    errors.push(`Invalid MINA_NETWORK: ${minaNetwork}. Must be testnet, or mainnet`);
  }

  // Database configuration - DATABASE_URL is required for PostgreSQL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    errors.push('Missing required environment variable: DATABASE_URL');
  }

  const config: Config = {
    port: getRequiredNumber('PORT'),
    nodeEnv: nodeEnv as 'development' | 'production' | 'test',
    databaseUrl: databaseUrl || '',
    minaNetwork: minaNetwork as 'testnet' | 'mainnet',
    zkappAddress: getRequired('ZKAPP_ADDRESS'),
    feePayerPrivateKey: getRequired('FEE_PAYER_PRIVATE_KEY'),
    corsOrigin: getRequired('CORS_ORIGIN'),
    uploadMaxSize: getRequiredNumber('UPLOAD_MAX_SIZE'),
    circuitCachePath: process.env.CIRCUIT_CACHE_PATH || './cache',
    minioEndpoint: getRequired('MINIO_ENDPOINT'),
    minioAccessKey: getRequired('MINIO_ROOT_USER'),
    minioSecretKey: getRequired('MINIO_ROOT_PASSWORD'),
    minioBucket: getRequired('MINIO_BUCKET'),
    ADMIN_PASSWORD: getRequired('ADMIN_PASSWORD'),
    archiveNodeEndpoint: getRequired('ARCHIVE_NODE_ENDPOINT'),
    minaNodeEndpoint: getRequired('MINA_NODE_ENDPOINT'),
    monitoringEnabled: getRequired('MONITORING_ENABLED') === 'true',
  };

  // Throw if any errors
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return config;
}

/**
 * Singleton config instance
 * Parsed and validated at module load time
 */
export const config: Config = parseConfig();
