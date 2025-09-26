import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import {
  API_URL,
  getRelativeDate,
  createTestChallenge,
  cleanupChallenges,
} from './utils/test-helpers.js';

describe('Challenges API Integration', () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    await cleanupChallenges(createdIds);
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
    // Create an active challenge (started yesterday, ends tomorrow)
    const challengeId = await createTestChallenge({
      title: 'Currently Active Integration Test',
      startDaysFromNow: -1,
      endDaysFromNow: 1,
    });
    createdIds.push(challengeId);

    // Get current
    const currentRes = await request(API_URL).get('/api/challenges/current');

    expect(currentRes.status).toBe(200);
    // Verify the correct challenge is returned
    expect(currentRes.body.id).toBe(challengeId);
    expect(currentRes.body.title).toBe('Currently Active Integration Test');
  });

  // Test 3: List all challenges
  it('should return all challenges', async () => {
    const res = await request(API_URL).get('/api/challenges');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // Should contain all our test challenges
    const ids = res.body.map((c: any) => c.id);
    createdIds.forEach((id) => {
      expect(ids).toContain(id);
    });
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
    const createRes = await request(API_URL)
      .post('/api/challenges')
      .send({
        title: 'Shape Test',
        description: 'Testing response shape',
        startTime: getRelativeDate(10),
        endTime: getRelativeDate(20),
      });

    createdIds.push(createRes.body.id);

    // Test POST response shape
    expect(createRes.body).toMatchObject({
      id: expect.any(String),
      title: 'Shape Test',
      description: 'Testing response shape',
      startTime: expect.any(String),
      endTime: expect.any(String),
      participantCount: 0,
      chainCount: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    // Test GET by ID response shape
    const getByIdRes = await request(API_URL).get(`/api/challenges/${createRes.body.id}`);
    expect(getByIdRes.body).toMatchObject({
      id: expect.any(String),
      title: 'Shape Test',
      description: 'Testing response shape',
      startTime: expect.any(String),
      endTime: expect.any(String),
      participantCount: 0,
      chainCount: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    // Test GET all response shape
    const getAllRes = await request(API_URL).get('/api/challenges');
    const foundChallenge = getAllRes.body.find((c: any) => c.id === createRes.body.id);
    expect(foundChallenge).toMatchObject({
      id: expect.any(String),
      title: 'Shape Test',
      description: 'Testing response shape',
      startTime: expect.any(String),
      endTime: expect.any(String),
      participantCount: 0,
      chainCount: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  // Test 8: Date validation
  it('should reject challenge when endTime is before startTime', async () => {
    const res = await request(API_URL).post('/api/challenges').send({
      title: 'Invalid Date Range',
      description: 'Test',
      startTime: '2024-12-31T00:00:00Z',
      endTime: '2024-01-01T00:00:00Z', // End is before start
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('endTime must be after startTime');
  });
});
