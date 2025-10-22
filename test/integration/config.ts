/**
 * Integration test configuration
 * Loads required environment variables for testing
 */
const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not defined`);
  }
  return value;
};

export const API_URL = getRequiredEnv('TEST_API_URL');
export const ADMIN_USERNAME = getRequiredEnv('TEST_ADMIN_USERNAME');
export const ADMIN_PASSWORD = getRequiredEnv('TEST_ADMIN_PASSWORD');

// ECDSA signer keys for image signature verification
export const SIGNER_PRIVATE_KEY = getRequiredEnv('SIGNER_PRIVATE_KEY');
