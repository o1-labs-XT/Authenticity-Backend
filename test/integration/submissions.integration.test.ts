import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { PrivateKey, Signature } from 'o1js';
import * as fs from 'fs';
import * as path from 'path';
import { prepareImageVerification } from 'authenticity-zkapp';
import {
  API_URL,
  createTestChallenge,
  cleanupChallenges,
  cleanupUsers,
  getChainLength,
} from './utils/test-helpers.js';

// 1. should create a submission with valid data
// 2. should reject submission without image
// 3. should reject submission without chainId
// 4. should reject submission without publicKey
// 5. should reject submission without signature
// 6. should reject submission with invalid publicKey
// format
// 7. should reject submission with invalid signature
// format
// 8. should reject submission with non-existent chainId
// 9. should reject submission to inactive challenge (not
//  started)
// 10. should reject submission to inactive challenge
// (ended)
// 11. should reject duplicate image submission with 409
// 12. should reject different image submission for same
// user and challenge
// 13. should increment chain position for sequential
// submissions
// 14. should retrieve a submission by ID
// 15. should retrieve submissions for a wallet address
// 16. should retrieve submissions for a chain
// 17. should retrieve submissions for a challenge
// 18. should retrieve submissions filtered by status
// 19. should return properly formatted response with
// camelCase fields
// 20. todo: should enqueue proof generation job after
// submission
// 21. should update chain length when submission is
// created
// 22. should increment challenge participant count on
// first submission
// ===== Submission-specific test helpers =====

interface SubmissionTestData {
  imageBuffer: Buffer;
  imagePath: string;
  signature: string;
  publicKey: string;
  privateKey: PrivateKey;
  sha256Hash: string;
  walletAddress: string;
}

function createSubmissionTestData(): SubmissionTestData {
  const privateKey = PrivateKey.random();
  const publicKey = privateKey.toPublicKey().toBase58();

  // Create a temporary test image file
  const imagePath = path.join(
    '/tmp',
    `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
  );

  // Write some test image data
  const imageBuffer = Buffer.from(imagePath);
  fs.writeFileSync(imagePath, imageBuffer);

  // Use prepareImageVerification to get the correct hash format
  const verificationInputs = prepareImageVerification(imagePath);
  const sha256Hash = verificationInputs.imageHash;

  // Sign using the expectedHash.toFields() - this is the correct way
  const signature = Signature.create(
    privateKey,
    verificationInputs.expectedHash.toFields()
  ).toBase58();

  return {
    imageBuffer,
    imagePath,
    signature,
    publicKey,
    privateKey,
    sha256Hash,
    walletAddress: publicKey,
  };
}

function cleanupSubmissionTestData(testData: SubmissionTestData): void {
  if (fs.existsSync(testData.imagePath)) {
    fs.unlinkSync(testData.imagePath);
  }
}

// ===== Tests start here =====

describe('Submissions API Integration', () => {
  let challengeId: string;
  let chainId: string;
  const createdSubmissionIds: string[] = [];
  const createdChallengeIds: string[] = [];
  const createdUserAddresses: string[] = [];

  beforeAll(async () => {
    // Setup: Create a test challenge
    challengeId = await createTestChallenge({
      title: 'Submissions Test Challenge',
      startDaysFromNow: -1,
      endDaysFromNow: 7,
    });
    createdChallengeIds.push(challengeId);

    // Get the default chain for this challenge
    const chainsRes = await request(API_URL).get(`/api/chains?challengeId=${challengeId}`);
    expect(chainsRes.status).toBe(200);
    expect(chainsRes.body.length).toBeGreaterThan(0);
    chainId = chainsRes.body[0].id;
  });

  afterEach(async () => {
    // Cleanup submissions
    await Promise.all(
      createdSubmissionIds.map((id) =>
        request(API_URL)
          .delete(`/api/submissions/${id}`)
          .catch(() => {})
      )
    );
    createdSubmissionIds.length = 0;

    // Cleanup users
    await cleanupUsers(createdUserAddresses);
    createdUserAddresses.length = 0;
  });

  afterAll(async () => {
    // Cleanup challenges (cascades to chains)
    await cleanupChallenges(createdChallengeIds);
  });

  // Test 1: Successful submission creation
  it('should create a submission with valid data', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create user
    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .field('tagline', 'My first submission!')
      .attach('image', testData.imagePath);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      sha256Hash: expect.any(String),
      walletAddress: testData.walletAddress,
      tokenOwnerAddress: expect.any(String),
      challengeId: challengeId,
      chainId: chainId,
      tagline: 'My first submission!',
      status: 'uploading',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    createdSubmissionIds.push(res.body.id);
    cleanupSubmissionTestData(testData);
  });

  // Test 2: Missing required fields
  it('should reject submission without image', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('image');
    cleanupSubmissionTestData(testData);
  });

  it('should reject submission without chainId', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('chainId');
    cleanupSubmissionTestData(testData);
  });

  it('should reject submission without publicKey', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('publicKey');
    cleanupSubmissionTestData(testData);
  });

  it('should reject submission without signature', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('signature');
    cleanupSubmissionTestData(testData);
  });

  // Test 3: Input validation
  it('should reject submission with invalid publicKey format', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', 'invalid-key')
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.field).toBe('publicKey');
    cleanupSubmissionTestData(testData);
  });

  it('should reject submission with invalid signature format', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', 'invalid-signature')
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.field).toBe('signature');
    cleanupSubmissionTestData(testData);
  });

  // Test 4: Non-existent references
  it('should reject submission with non-existent chainId', async () => {
    const testData = createSubmissionTestData();
    const fakeChainId = '00000000-0000-0000-0000-000000000000';

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', fakeChainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Chain');
    cleanupSubmissionTestData(testData);
  });

  it('should reject submission to inactive challenge (not started)', async () => {
    const testData = createSubmissionTestData();

    // Create a challenge that hasn't started yet
    const futureChallenge = await createTestChallenge({
      title: 'Future Challenge',
      startDaysFromNow: 1, // Starts tomorrow
      endDaysFromNow: 7,
    });
    createdChallengeIds.push(futureChallenge);

    // Get its chain
    const chainsRes = await request(API_URL).get(`/api/chains?challengeId=${futureChallenge}`);
    const futureChainId = chainsRes.body[0].id;

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', futureChainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('not currently active');
    cleanupSubmissionTestData(testData);
  });

  it('should reject submission to inactive challenge (ended)', async () => {
    const testData = createSubmissionTestData();

    // Create a challenge that has already ended
    const pastChallenge = await createTestChallenge({
      title: 'Past Challenge',
      startDaysFromNow: -7, // Started 7 days ago
      endDaysFromNow: -1, // Ended yesterday
    });
    createdChallengeIds.push(pastChallenge);

    // Get its chain
    const chainsRes = await request(API_URL).get(`/api/chains?challengeId=${pastChallenge}`);
    const pastChainId = chainsRes.body[0].id;

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', pastChainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('not currently active');
    cleanupSubmissionTestData(testData);
  });

  // Test 5a: Duplicate submission with same image (should return 409 conflict)
  it('should reject duplicate image submission with 409', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create user
    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    // First submission
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(res1.status).toBe(201);
    createdSubmissionIds.push(res1.body.id);

    // Second submission with same image (should return 409 conflict)
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(res2.status).toBe(409);
    expect(res2.body.error.message).toContain('already submitted');

    cleanupSubmissionTestData(testData);
  });

  // Test 5b: Different image for same challenge (should return 409)
  it('should reject different image submission for same user and challenge', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress);

    // Create user
    await request(API_URL).post('/api/users').send({ walletAddress: testData1.walletAddress });

    // First submission
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData1.publicKey)
      .field('signature', testData1.signature)
      .attach('image', testData1.imagePath);

    expect(res1.status).toBe(201);
    createdSubmissionIds.push(res1.body.id);

    // Second submission with different image (should return 409)
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData1.publicKey)
      .field('signature', testData2.signature)
      .attach('image', testData2.imagePath);

    expect(res2.status).toBe(409);
    expect(res2.body.error.message).toContain('already submitted');

    cleanupSubmissionTestData(testData1);
    cleanupSubmissionTestData(testData2);
  });

  // Test 6: Chain position increment
  it('should increment chain position for sequential submissions', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress, testData2.walletAddress);

    // Create users
    await request(API_URL).post('/api/users').send({ walletAddress: testData1.walletAddress });
    await request(API_URL).post('/api/users').send({ walletAddress: testData2.walletAddress });

    // Get current chain length
    const initialLength = await getChainLength(chainId);

    // First submission
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData1.publicKey)
      .field('signature', testData1.signature)
      .attach('image', testData1.imagePath);

    expect(res1.status).toBe(201);
    expect(res1.body.chainPosition).toBe(initialLength + 1);
    createdSubmissionIds.push(res1.body.id);

    // Second submission from different user with different image
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData2.publicKey)
      .field('signature', testData2.signature)
      .attach('image', testData2.imagePath);

    expect(res2.status).toBe(201);
    expect(res2.body.chainPosition).toBe(initialLength + 2);
    createdSubmissionIds.push(res2.body.id);

    cleanupSubmissionTestData(testData1);
    cleanupSubmissionTestData(testData2);
  });

  // Test 7: GET submission by ID
  it('should retrieve a submission by ID', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .field('tagline', 'Test GET')
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    const submissionId = createRes.body.id;
    createdSubmissionIds.push(submissionId);

    const getRes = await request(API_URL).get(`/api/submissions/${submissionId}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: submissionId,
      tagline: 'Test GET',
      status: 'uploading',
    });

    cleanupSubmissionTestData(testData);
  });

  // Test 8: GET submissions by wallet address
  it('should retrieve submissions for a wallet address', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    createdSubmissionIds.push(createRes.body.id);

    const getRes = await request(API_URL).get(
      `/api/submissions?walletAddress=${testData.walletAddress}`
    );

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBeGreaterThan(0);
    expect(getRes.body[0].walletAddress).toBe(testData.walletAddress);

    cleanupSubmissionTestData(testData);
  });

  // Test 9: GET submissions by chain
  it('should retrieve submissions for a chain', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    createdSubmissionIds.push(createRes.body.id);

    const getRes = await request(API_URL).get(`/api/submissions?chainId=${chainId}`);

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBeGreaterThan(0);
    expect(getRes.body[0].chainId).toBe(chainId);

    cleanupSubmissionTestData(testData);
  });

  // Test 10: GET submissions by challenge
  it('should retrieve submissions for a challenge', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    createdSubmissionIds.push(createRes.body.id);

    const getRes = await request(API_URL).get(`/api/submissions?challengeId=${challengeId}`);

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBeGreaterThan(0);
    expect(getRes.body[0].challengeId).toBe(challengeId);

    cleanupSubmissionTestData(testData);
  });

  // Test 11: GET submissions by status
  it('should retrieve submissions filtered by status', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    createdSubmissionIds.push(createRes.body.id);

    // Query for submissions with 'uploaded' status
    const getRes = await request(API_URL).get('/api/submissions?status=uploaded');

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBeGreaterThan(0);
    // All returned submissions should have 'uploaded' status
    expect(getRes.body.every((sub: any) => sub.status === 'uploaded')).toBe(true);

    cleanupSubmissionTestData(testData);
  });

  // Test 13: Response shape validation
  it('should return properly formatted response with camelCase fields', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .field('tagline', 'Shape test')
      .attach('image', testData.imagePath);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      sha256Hash: expect.any(String),
      walletAddress: expect.any(String),
      tokenOwnerAddress: expect.any(String),
      publicKey: expect.any(String),
      signature: expect.any(String),
      challengeId: expect.any(String),
      chainId: expect.any(String),
      tagline: 'Shape test',
      chainPosition: expect.any(Number),
      status: 'uploading',
      retryCount: 0,
      challengeVerified: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    // Should NOT include private key in response
    expect(res.body.tokenOwnerPrivateKey).toBeUndefined();

    createdSubmissionIds.push(res.body.id);
    cleanupSubmissionTestData(testData);
  });

  // Test 14: Job queue integration
  it('todo: should enqueue proof generation job after submission', async () => {
    // todo - should we enqueue proof generation now or after the admin approves the submission
  });

  // Test 15: Chain length update
  it('should update chain length when submission is created', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    // Get initial chain length
    const initialLength = await getChainLength(chainId);

    // Create submission
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(201);
    createdSubmissionIds.push(res.body.id);

    // Check chain length increased
    const updatedLength = await getChainLength(chainId);
    expect(updatedLength).toBe(initialLength + 1);

    cleanupSubmissionTestData(testData);
  });

  // Test 16: Challenge participant count update
  it('should increment challenge participant count on first submission', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    // Create a fresh challenge
    const newChallengeId = await createTestChallenge({
      title: 'Participant Count Test',
      startDaysFromNow: -1,
      endDaysFromNow: 7,
    });
    createdChallengeIds.push(newChallengeId);

    // Get its default chain
    const chainsRes = await request(API_URL).get(`/api/chains?challengeId=${newChallengeId}`);
    const newChainId = chainsRes.body[0].id;

    // Get initial participant count
    const initialRes = await request(API_URL).get(`/api/challenges/${newChallengeId}`);
    const initialCount = initialRes.body.participantCount;

    // Create submission
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', newChainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(201);
    createdSubmissionIds.push(res.body.id);

    // Check participant count increased
    const updatedRes = await request(API_URL).get(`/api/challenges/${newChallengeId}`);
    expect(updatedRes.body.participantCount).toBe(initialCount + 1);

    cleanupSubmissionTestData(testData);
  });
});
