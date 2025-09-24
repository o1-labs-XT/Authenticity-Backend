import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

// For integration tests, we'll use the actual running server
const API_URL = 'http://localhost:3000';

describe('Challenges API Integration', () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    // Clean up any test data we created
    for (const id of createdIds) {
      await request(API_URL)
        .delete(`/api/challenges/${id}`)
        .catch(() => {}); // Ignore errors if already deleted
    }
    createdIds.length = 0;
  });

  // Test 1: Full lifecycle
  it('should create, retrieve, and delete a challenge', async () => {
    // CREATE
    const createRes = await request(API_URL).post('/api/challenges').send({
      title: 'Integration Test Challenge',
      description: 'Testing the full flow',
      startTime: '2024-01-01T00:00:00Z',
      endTime: '2024-12-31T00:00:00Z',
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.id).toBeDefined();
    const challengeId = createRes.body.id;

    // RETRIEVE
    const getRes = await request(API_URL).get(`/api/challenges/${challengeId}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.title).toBe('Integration Test Challenge');

    // DELETE
    const deleteRes = await request(API_URL).delete(`/api/challenges/${challengeId}`);

    expect(deleteRes.status).toBe(204);

    // VERIFY DELETED
    const verifyRes = await request(API_URL).get(`/api/challenges/${challengeId}`);

    expect(verifyRes.status).toBe(404);
  });

  // Test 2: Current challenge logic
  it('should return current active challenge', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);
    const tomorrow = new Date(now.getTime() + 86400000);

    // Create an active challenge
    const createRes = await request(API_URL).post('/api/challenges').send({
      title: 'Currently Active Integration Test',
      description: 'Should be returned as current',
      startTime: yesterday.toISOString(),
      endTime: tomorrow.toISOString(),
    });

    const challengeId = createRes.body.id;
    createdIds.push(challengeId);

    // Get current
    const currentRes = await request(API_URL).get('/api/challenges/current');

    expect(currentRes.status).toBe(200);
    // The most recent active challenge should be returned
    expect(currentRes.body).toBeDefined();
    expect(currentRes.body.id).toBeDefined();
  });

  // Test 3: List all challenges
  it('should return all challenges', async () => {
    const res = await request(API_URL).get('/api/challenges');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // Test 4: 404 for non-existent
  it('should return 404 for non-existent challenge', async () => {
    const res = await request(API_URL).get('/api/challenges/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
  });

  // Test 5: Validation error (smoke test)
  it('should return 400 for missing required fields', async () => {
    const res = await request(API_URL)
      .post('/api/challenges')
      .send({ title: 'Missing other fields' });

    expect(res.status).toBe(400);
  });

  // Test 6: Delete non-existent
  it('should return 404 when deleting non-existent challenge', async () => {
    const res = await request(API_URL).delete(
      '/api/challenges/00000000-0000-0000-0000-000000000000'
    );

    expect(res.status).toBe(404);
  });

  // Test 7: Response shape validation
  it('should return properly formatted response with camelCase fields', async () => {
    const createRes = await request(API_URL).post('/api/challenges').send({
      title: 'Shape Test',
      description: 'Testing response shape',
      startTime: '2024-06-01T00:00:00Z',
      endTime: '2024-06-30T00:00:00Z',
    });

    createdIds.push(createRes.body.id);

    expect(createRes.body).toMatchObject({
      id: expect.any(String),
      title: 'Shape Test',
      description: 'Testing response shape',
      startTime: expect.any(String),
      endTime: expect.any(String),
      participantCount: 0,
      chainCount: 1,
    });

    // Verify dates are properly formatted
    expect(new Date(createRes.body.startTime).toISOString()).toBe(createRes.body.startTime);
    expect(new Date(createRes.body.endTime).toISOString()).toBe(createRes.body.endTime);
  });
});
