import request from 'supertest';
import { API_URL, ADMIN_USERNAME, ADMIN_PASSWORD } from '../config.js';

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

  return res.body.id;
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
