import request from 'supertest';
import knex, { Knex } from 'knex';
import { PrivateKey } from 'o1js';
import { API_URL, ADMIN_USERNAME, ADMIN_PASSWORD } from '../config.js';

// Database connection for direct access (used to bypass worker deployment in tests)
let dbConnection: Knex | null = null;

const getDbConnection = (): Knex => {
  if (!dbConnection) {
    dbConnection = knex({
      client: 'pg',
      connection: {
        connectionString: process.env.DATABASE_URL,
        ssl: false,
      },
    });
  }
  return dbConnection;
};

/**
 * Manually mark a challenge as deployed with mock zkApp data
 * This bypasses the actual contract deployment worker for testing
 */
export const markChallengeAsDeployed = async (challengeId: string): Promise<void> => {
  const db = getDbConnection();

  // Generate a mock zkApp address (valid format but not actually deployed)
  const mockZkAppAddress = PrivateKey.random().toPublicKey().toBase58();
  const mockTxHash = `mock-tx-${Date.now()}`;

  await db('challenges').where({ id: challengeId }).update({
    deployment_status: 'active',
    zkapp_address: mockZkAppAddress,
    deployment_transaction_hash: mockTxHash,
    deployment_completed_at: new Date().toISOString(),
    deployment_failure_reason: null,
  });
};

/**
 * Creates a date relative to the current date
 * @param daysFromNow Number of days from now (positive for future, negative for past)
 */
export const getRelativeDate = (daysFromNow: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString();
};

/**
 * Creates a test challenge for integration testing
 * Automatically marks the challenge as deployed (bypassing worker deployment)
 * @param options Optional configuration
 * @returns Challenge ID
 */
export const createTestChallenge = async (options?: {
  title?: string;
  startDaysFromNow?: number;
  endDaysFromNow?: number;
}): Promise<string> => {
  const res = await request(API_URL)
    .post('/api/challenges')
    .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
    .send({
      title: options?.title || `Test Challenge ${Date.now()}`,
      description: 'Challenge for integration testing',
      startTime: getRelativeDate(options?.startDaysFromNow ?? 1),
      endTime: getRelativeDate(options?.endDaysFromNow ?? 7),
    });

  if (res.status !== 201) {
    throw new Error(`Failed to create test challenge: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const challengeId = res.body.id;

  // Mark challenge as deployed with mock zkApp data (bypasses worker deployment for tests)
  await markChallengeAsDeployed(challengeId);

  return challengeId;
};

/**
 * Cleanup test challenges, ignoring errors
 */
export const cleanupChallenges = async (ids: string[]): Promise<void> => {
  await Promise.all(
    ids.map((id) =>
      request(API_URL)
        .delete(`/api/challenges/${id}`)
        .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
        .catch(() => {})
    )
  );
};

/**
 * Cleanup test users, ignoring errors
 */
export const cleanupUsers = async (walletAddresses: string[]): Promise<void> => {
  await Promise.all(
    walletAddresses.map((address) =>
      request(API_URL)
        .delete(`/api/users/${address}`)
        .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
        .catch(() => {})
    )
  );
};

/**
 * Get current chain length for dynamic position assertions
 */
export const getChainLength = async (chainId: string): Promise<number> => {
  const res = await request(API_URL).get(`/api/chains/${chainId}`);
  if (res.status !== 200) {
    throw new Error(`Failed to get chain length: ${res.status}`);
  }
  return res.body.length || 0;
};

/**
 * Get like count for a submission
 */
export const getLikeCount = async (submissionId: string): Promise<number> => {
  const res = await request(API_URL).get(`/api/submissions/${submissionId}/likes/count`);
  if (res.status !== 200) {
    throw new Error(`Failed to get like count: ${res.status}`);
  }
  return res.body.count;
};
