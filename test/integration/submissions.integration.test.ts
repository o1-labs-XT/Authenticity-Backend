import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { PrivateKey, Signature } from 'o1js';
import * as fs from 'fs';
import * as path from 'path';
import { prepareImageVerification } from 'authenticity-zkapp';
import { API_URL } from './config.js';
import {
  createTestChallenge,
  cleanupChallenges,
  cleanupUsers,
  getChainLength,
} from './utils/test-helpers.js';

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
  const walletAddress = privateKey.toPublicKey().toBase58();

  // Create a temporary test image file in project tmp directory
  const tmpDir = path.join(process.cwd(), 'tmp', 'test-uploads');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const imagePath = path.join(
    tmpDir,
    `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
  );
  const imageBuffer = Buffer.from(imagePath);
  fs.writeFileSync(imagePath, imageBuffer);

  // Use prepareImageVerification to get the correct hash format
  const verificationInputs = prepareImageVerification(imagePath);
  const sha256Hash = verificationInputs.expectedHash;

  // Sign using the expectedHash.toFields() - this is the correct way
  const signature = Signature.create(privateKey, sha256Hash.toFields()).toBase58();

  return {
    imageBuffer,
    imagePath,
    signature,
    publicKey: walletAddress,
    privateKey,
    sha256Hash,
    walletAddress,
  };
}

describe('Submissions API Integration', () => {
  // tests will share a challenge and chain
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
    expect(chainsRes.body.length).toBe(1);
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

    // Cleanup temp test files
    const tmpDir = path.join(process.cwd(), 'tmp', 'test-uploads');
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should create a submission with valid data and auto-create user', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

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
      publicKey: testData.publicKey,
      signature: testData.signature,
      challengeId: challengeId,
      chainId: chainId,
      tagline: 'My first submission!',
      chainPosition: expect.any(Number),
      status: 'uploading',
      retryCount: 0,
      challengeVerified: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    // Should NOT include private key in response
    expect(res.body.tokenOwnerPrivateKey).toBeUndefined();

    // Verify user was auto-created
    const userRes = await request(API_URL).get(`/api/users/${testData.walletAddress}`);
    expect(userRes.status).toBe(200);
    expect(userRes.body.walletAddress).toBe(testData.walletAddress);

    createdSubmissionIds.push(res.body.id);
  });

  it('should allow existing user to create submission', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Pre-create user
    await request(API_URL).post('/api/users').send({ walletAddress: testData.walletAddress });

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .field('tagline', 'Existing user submission')
      .attach('image', testData.imagePath);

    expect(res.status).toBe(201);
    expect(res.body.walletAddress).toBe(testData.walletAddress);

    createdSubmissionIds.push(res.body.id);
  });

  it('should reject submission without image or with empty image', async () => {
    const testData = createSubmissionTestData();

    // Test missing image
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature);

    expect(res1.status).toBe(400);
    expect(res1.body.error.field).toBe('image');

    // Test empty image file
    const tmpDir = path.join(process.cwd(), 'tmp', 'test-uploads');
    const emptyImagePath = path.join(tmpDir, `empty-test-${Date.now()}.png`);
    fs.writeFileSync(emptyImagePath, Buffer.alloc(0));

    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', emptyImagePath);

    expect(res2.status).toBe(400);
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
  });

  it('should reject submission with mismatched signature, image, or publicKey', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();

    // Test 1: Wrong image (signature for image1, but submitting image2)
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData1.publicKey)
      .field('signature', testData1.signature) // Signature for image1
      .attach('image', testData2.imagePath); // But submitting image2

    expect(res1.status).toBe(400);
    expect(res1.body.error.message).toContain('Invalid signature for public key and image hash');

    // Test 2: Wrong publicKey (signature created with key1, but claiming key2)
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData2.publicKey) // Different public key
      .field('signature', testData1.signature) // Signature from testData1
      .attach('image', testData1.imagePath);

    expect(res2.status).toBe(400);
    expect(res2.body.error.message).toContain('Invalid signature for public key and image hash');
  });

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
  });

  it('should reject duplicate image submission with 409', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

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
  });

  it('should reject different image submission for same user and challenge', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress);

    // First submission
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData1.publicKey)
      .field('signature', testData1.signature)
      .attach('image', testData1.imagePath);

    expect(res1.status).toBe(201);
    createdSubmissionIds.push(res1.body.id);

    // Create valid signature for second image using same private key
    const verificationInputs2 = prepareImageVerification(testData2.imagePath);
    const signature2 = Signature.create(
      testData1.privateKey,
      verificationInputs2.expectedHash.toFields()
    ).toBase58();

    // Second submission with different image but same user (should return 409)
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData1.publicKey)
      .field('signature', signature2)
      .attach('image', testData2.imagePath);

    expect(res2.status).toBe(409);
    expect(res2.body.error.message).toContain('already submitted');
  });

  it('should increment chain position and update chain length for sequential submissions', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress, testData2.walletAddress);

    // Create a fresh challenge to ensure predictable chain positions
    const newChallengeId = await createTestChallenge({
      title: 'Chain Position Test',
      startDaysFromNow: -1,
      endDaysFromNow: 7,
    });
    createdChallengeIds.push(newChallengeId);

    // Get its default chain
    const chainsRes = await request(API_URL).get(`/api/chains?challengeId=${newChallengeId}`);
    const newChainId = chainsRes.body[0].id;

    // Get initial chain length (should be 0 for fresh chain)
    const initialLength = await getChainLength(newChainId);

    // First submission
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', newChainId)
      .field('publicKey', testData1.publicKey)
      .field('signature', testData1.signature)
      .attach('image', testData1.imagePath);

    expect(res1.status).toBe(201);
    expect(res1.body.chainPosition).toBe(initialLength + 1);
    createdSubmissionIds.push(res1.body.id);

    // Verify chain length updated
    const lengthAfterFirst = await getChainLength(newChainId);
    expect(lengthAfterFirst).toBe(initialLength + 1);

    // Second submission from different user with different image
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', newChainId)
      .field('publicKey', testData2.publicKey)
      .field('signature', testData2.signature)
      .attach('image', testData2.imagePath);

    expect(res2.status).toBe(201);
    expect(res2.body.chainPosition).toBe(initialLength + 2);
    createdSubmissionIds.push(res2.body.id);

    // Verify chain length updated again
    const lengthAfterSecond = await getChainLength(newChainId);
    expect(lengthAfterSecond).toBe(initialLength + 2);
  });

  // Test 7: GET submission by ID
  it('should retrieve a submission by ID', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

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
      sha256Hash: createRes.body.sha256Hash,
      storageKey: createRes.body.storageKey,
      walletAddress: testData.walletAddress,
    });
  });

  // Test 8: GET submissions by wallet address
  it('should retrieve submissions for a wallet address', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

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
    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].walletAddress).toBe(testData.walletAddress);
  });

  // Test 9: GET submissions by chain
  it('should retrieve submissions for a chain', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress, testData2.walletAddress);

    // Create a fresh challenge for this test
    const newChallengeId = await createTestChallenge({
      title: 'Chain Query Test',
      startDaysFromNow: -1,
      endDaysFromNow: 7,
    });
    createdChallengeIds.push(newChallengeId);

    // Get its chain
    const chainsRes = await request(API_URL).get(`/api/chains?challengeId=${newChallengeId}`);
    const newChainId = chainsRes.body[0].id;

    // Create 2 submissions
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', newChainId)
      .field('publicKey', testData1.publicKey)
      .field('signature', testData1.signature)
      .attach('image', testData1.imagePath);

    expect(res1.status).toBe(201);
    createdSubmissionIds.push(res1.body.id);

    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', newChainId)
      .field('publicKey', testData2.publicKey)
      .field('signature', testData2.signature)
      .attach('image', testData2.imagePath);

    expect(res2.status).toBe(201);
    createdSubmissionIds.push(res2.body.id);

    // Query by chain
    const getRes = await request(API_URL).get(`/api/submissions?chainId=${newChainId}`);

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBe(2);
    expect(getRes.body.every((s: any) => s.chainId === newChainId)).toBe(true);
  });

  // Test 10: GET submissions by challenge
  it('should retrieve submissions for a challenge', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress, testData2.walletAddress);

    // Create a fresh challenge for this test
    const newChallengeId = await createTestChallenge({
      title: 'Challenge Query Test',
      startDaysFromNow: -1,
      endDaysFromNow: 7,
    });
    createdChallengeIds.push(newChallengeId);

    // Get its chain
    const chainsRes = await request(API_URL).get(`/api/chains?challengeId=${newChallengeId}`);
    const newChainId = chainsRes.body[0].id;

    // Create 2 submissions
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', newChainId)
      .field('publicKey', testData1.publicKey)
      .field('signature', testData1.signature)
      .attach('image', testData1.imagePath);

    expect(res1.status).toBe(201);
    createdSubmissionIds.push(res1.body.id);

    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', newChainId)
      .field('publicKey', testData2.publicKey)
      .field('signature', testData2.signature)
      .attach('image', testData2.imagePath);

    expect(res2.status).toBe(201);
    createdSubmissionIds.push(res2.body.id);

    // Query by challenge
    const getRes = await request(API_URL).get(`/api/submissions?challengeId=${newChallengeId}`);

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBe(2);
    expect(getRes.body.every((s: any) => s.challengeId === newChallengeId)).toBe(true);
  });

  it('should retrieve submissions filtered by status', async () => {
    // todo: need to test status changes
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', testData.publicKey)
      .field('signature', testData.signature)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    createdSubmissionIds.push(createRes.body.id);

    // Query for submissions with 'uploading' status
    const getRes = await request(API_URL).get('/api/submissions?status=uploading');

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBeGreaterThan(0);
    // All returned submissions should have 'uploaded' status
    expect(getRes.body.every((sub: any) => sub.status === 'uploading')).toBe(true);
  });

  it('todo: should enqueue proof generation job after submission', async () => {
    // todo - should we enqueue proof generation now or after the admin approves the submission
  });

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
  });

  it('should increment challenge participant count on first submission', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

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
  });
});
