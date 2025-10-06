import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { API_URL } from './config.js';
import { createTestChallenge, cleanupChallenges } from './utils/test-helpers.js';

describe('Chains API Integration', () => {
  const createdChallenges: string[] = [];

  afterEach(async () => {
    await cleanupChallenges(createdChallenges);
    createdChallenges.length = 0;
  });

  // Test 1: Auto-creation and retrieval flow
  it('should automatically create chain when challenge is created', async () => {
    // CREATE CHALLENGE (chain auto-created)
    const challengeId = await createTestChallenge();
    createdChallenges.push(challengeId);

    // LIST CHAINS FOR CHALLENGE
    const listRes = await request(API_URL).get(`/api/chains?challengeId=${challengeId}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    const chain = listRes.body[0];
    const chainId = chain.id;

    // GET CHAIN BY ID
    const getRes = await request(API_URL).get(`/api/chains/${chainId}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: chainId,
      name: 'Default',
      challengeId: challengeId,
      length: 0,
    });
  });

  // Test 2: List all chains
  it('should return all chains', async () => {
    // Create two challenges (each auto-creates a chain)
    const firstId = await createTestChallenge({ title: 'First' });
    createdChallenges.push(firstId);
    const secondId = await createTestChallenge({ title: 'Second' });
    createdChallenges.push(secondId);

    const res = await request(API_URL).get('/api/chains');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // Find our test chains
    const chainIds = res.body.map((c: any) => c.challengeId);
    expect(chainIds).toContain(firstId);
    expect(chainIds).toContain(secondId);
  });

  // Test 3: Filter by challengeId
  it('should filter chains by challengeId', async () => {
    const challengeId = await createTestChallenge();
    createdChallenges.push(challengeId);

    const res = await request(API_URL).get(`/api/chains?challengeId=${challengeId}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].challengeId).toBe(challengeId);
    expect(res.body[0].name).toBe('Default');
  });

  // Test 4: 404 for non-existent chain
  it('should return 404 for non-existent chain', async () => {
    const res = await request(API_URL).get('/api/chains/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toBe('Chain not found');
  });

  // Test 5: Empty array for non-existent challenge filter
  it('should return empty array when filtering by non-existent challenge', async () => {
    const res = await request(API_URL).get(
      '/api/chains?challengeId=00000000-0000-0000-0000-000000000000'
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // Test 6: Response shape validation
  it('should return properly formatted response with camelCase fields', async () => {
    const challengeId = await createTestChallenge();
    createdChallenges.push(challengeId);

    // Test GET with query param response shape
    const res = await request(API_URL).get(`/api/chains?challengeId=${challengeId}`);
    expect(res.status).toBe(200);
    const chain = res.body[0];

    expect(chain).toMatchObject({
      id: expect.any(String),
      name: 'Default',
      challengeId: challengeId,
      length: 0,
      createdAt: expect.any(String),
      lastActivityAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    // Test GET by ID response shape
    const getByIdRes = await request(API_URL).get(`/api/chains/${chain.id}`);
    expect(getByIdRes.body).toMatchObject({
      id: chain.id,
      name: 'Default',
      challengeId: challengeId,
      length: 0,
      createdAt: expect.any(String),
      lastActivityAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });
});
