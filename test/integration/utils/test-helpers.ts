import request from 'supertest';

export const API_URL = 'http://localhost:3000';

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
        .catch(() => {})
    )
  );
};
