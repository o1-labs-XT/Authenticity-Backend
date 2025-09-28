import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { PrivateKey } from 'o1js';
import { API_URL, ADMIN_USERNAME, ADMIN_PASSWORD } from './utils/test-helpers.js';

describe('Users API Integration', () => {
  const createdWallets: string[] = [];

  // Generate valid Mina wallet addresses using o1js
  const validWallet = PrivateKey.random().toPublicKey().toBase58();
  const anotherValidWallet = PrivateKey.random().toPublicKey().toBase58();
  const invalidWallet = 'invalid-wallet-address';

  afterEach(async () => {
    // Clean up created users with authentication
    for (const wallet of createdWallets) {
      await request(API_URL).delete(`/api/users/${wallet}`).auth(ADMIN_USERNAME, ADMIN_PASSWORD);
    }
    createdWallets.length = 0;
  });

  describe('POST /api/users', () => {
    it('should create new user with valid wallet address', async () => {
      const res = await request(API_URL).post('/api/users').send({ walletAddress: validWallet });

      expect(res.status).toBe(201);
      expect(res.body.walletAddress).toBe(validWallet);
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();

      createdWallets.push(validWallet);
    });

    it('should return existing user with 200 when created twice', async () => {
      // First create
      const createRes = await request(API_URL)
        .post('/api/users')
        .send({ walletAddress: anotherValidWallet });

      expect(createRes.status).toBe(201);
      createdWallets.push(anotherValidWallet);

      // Second create (should return existing)
      const existingRes = await request(API_URL)
        .post('/api/users')
        .send({ walletAddress: anotherValidWallet });

      expect(existingRes.status).toBe(200);
      expect(existingRes.body.walletAddress).toBe(anotherValidWallet);
      expect(existingRes.body.createdAt).toBe(createRes.body.createdAt);
    });

    it('should reject invalid wallet address', async () => {
      const res = await request(API_URL).post('/api/users').send({ walletAddress: invalidWallet });

      expect(res.status).toBe(400);
      expect(res.body.error.field).toBe('walletAddress');
      expect(res.body.error.message).toContain('Invalid wallet address');
    });

    it('should reject missing wallet address', async () => {
      const res = await request(API_URL).post('/api/users').send({});

      expect(res.status).toBe(400);
      expect(res.body.error.field).toBe('walletAddress');
      expect(res.body.error.message).toContain('required');
    });
  });

  describe('GET /api/users/:walletAddress', () => {
    beforeAll(async () => {
      // Create a user for GET tests
      await request(API_URL).post('/api/users').send({ walletAddress: validWallet });
      createdWallets.push(validWallet);
    });

    it('should return existing user', async () => {
      const res = await request(API_URL).get(`/api/users/${validWallet}`);

      expect(res.status).toBe(200);
      expect(res.body.walletAddress).toBe(validWallet);
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();
    });

    it('should return 404 for non-existent user', async () => {
      const nonExistentWallet = PrivateKey.random().toPublicKey().toBase58();
      const res = await request(API_URL).get(`/api/users/${nonExistentWallet}`);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('User not found');
    });

    it('should return 404 for invalid wallet address', async () => {
      const res = await request(API_URL).get(`/api/users/${invalidWallet}`);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('User not found');
    });
  });

  describe('DELETE /api/users/:walletAddress', () => {
    it('should require authentication for deleting users', async () => {
      // Create a user first
      const testWallet = PrivateKey.random().toPublicKey().toBase58();
      await request(API_URL).post('/api/users').send({ walletAddress: testWallet });
      createdWallets.push(testWallet);

      // Try to delete without auth - should fail
      const deleteNoAuthRes = await request(API_URL).delete(`/api/users/${testWallet}`);
      expect(deleteNoAuthRes.status).toBe(401);

      // Verify user still exists
      const getRes = await request(API_URL).get(`/api/users/${testWallet}`);
      expect(getRes.status).toBe(200);
    });

    it('should delete existing user with authentication', async () => {
      // Create a user first
      const testWallet = PrivateKey.random().toPublicKey().toBase58();
      await request(API_URL).post('/api/users').send({ walletAddress: testWallet });

      // Delete the user with auth
      const deleteRes = await request(API_URL)
        .delete(`/api/users/${testWallet}`)
        .auth(ADMIN_USERNAME, ADMIN_PASSWORD);

      expect(deleteRes.status).toBe(204);

      // Verify user is deleted
      const getRes = await request(API_URL).get(`/api/users/${testWallet}`);

      expect(getRes.status).toBe(404);
    });

    it('should return 404 when deleting non-existent user with auth', async () => {
      const nonExistentWallet = PrivateKey.random().toPublicKey().toBase58();
      const res = await request(API_URL)
        .delete(`/api/users/${nonExistentWallet}`)
        .auth(ADMIN_USERNAME, ADMIN_PASSWORD);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('User not found');
    });
  });
});
