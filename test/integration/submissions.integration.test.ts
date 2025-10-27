import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { PrivateKey } from 'o1js';
import * as fs from 'fs';
import * as path from 'path';
import { prepareImageVerification, Ecdsa, Secp256r1 } from 'authenticity-zkapp';
import { API_URL, ADMIN_USERNAME, ADMIN_PASSWORD, SIGNER_PRIVATE_KEY } from './config.js';
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
  signatureR: string;
  signatureS: string;
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
    `test-${Date.now()}-${Math.random().toString(36).substring(2, 11)}.png`
  );
  const imageBuffer = Buffer.from(imagePath);
  fs.writeFileSync(imagePath, imageBuffer);

  // Use prepareImageVerification to get the correct hash format
  const verificationInputs = prepareImageVerification(imagePath);
  const sha256Hash = verificationInputs.expectedHash;

  // Create ECDSA signature using the SIGNER_PRIVATE_KEY from config
  const signerPrivateKeyBigInt = BigInt(SIGNER_PRIVATE_KEY);
  const creatorKey = Secp256r1.Scalar.from(signerPrivateKeyBigInt);
  const signature = Ecdsa.signHash(verificationInputs.expectedHash, creatorKey.toBigInt());

  // Extract signature components as hex strings
  const signatureData = signature.toBigInt();
  const signatureR = signatureData.r.toString(16).padStart(64, '0');
  const signatureS = signatureData.s.toString(16).padStart(64, '0');

  return {
    imageBuffer,
    imagePath,
    signatureR,
    signatureS,
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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .field('tagline', 'My first submission!')
      .attach('image', testData.imagePath);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      sha256Hash: expect.any(String),
      walletAddress: testData.walletAddress,
      signature: expect.any(String), // Will be JSON stringified ECDSA signature
      challengeId: challengeId,
      chainId: chainId,
      tagline: 'My first submission!',
      chainPosition: expect.any(Number),
      status: 'awaiting_review',
      retryCount: 0,
      challengeVerified: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS);

    expect(res1.status).toBe(400);
    expect(res1.body.error.field).toBe('image');

    // Test empty image file
    const tmpDir = path.join(process.cwd(), 'tmp', 'test-uploads');
    const emptyImagePath = path.join(tmpDir, `empty-test-${Date.now()}.png`);
    fs.writeFileSync(emptyImagePath, Buffer.alloc(0));

    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', emptyImagePath);

    expect(res2.status).toBe(400);
  });

  it('should reject submission without chainId', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('chainId');
  });

  it('should reject submission without walletAddress', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('walletAddress');
  });

  it('should reject submission without signature', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('signature');
  });

  // Test 3: Input validation
  it('should reject submission with invalid walletAddress format', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', 'invalid-key')
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.field).toBe('walletAddress');
  });

  it('should reject submission with invalid signature format', async () => {
    const testData = createSubmissionTestData();

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', 'invalid-signature-component')
      .field('signatureS', 'invalid-signature-component')
      .attach('image', testData.imagePath);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.field).toBe('signature');
  });

  it('should reject submission with mismatched signature, image, or walletAddress', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();

    // Test 1: Use signature from testData2's image with testData1's image (hash mismatch)
    // testData2's signature is valid for testData2's image hash, but not for testData1's
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData1.walletAddress)
      .field('signatureR', testData2.signatureR) // Signature for different image
      .field('signatureS', testData2.signatureS)
      .attach('image', testData1.imagePath); // Different image

    expect(res1.status).toBe(400);
    expect(res1.body.error.message).toContain('ECDSA signature does not match image hash');

    // Test 2: Use clearly corrupted signature (all zeros)
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData1.walletAddress)
      .field('signatureR', '0'.repeat(64)) // Clearly invalid
      .field('signatureS', '0'.repeat(64)) // Clearly invalid
      .attach('image', testData1.imagePath);

    expect(res2.status).toBe(400);
    expect(res2.body.error.message).toContain('ECDSA signature does not match image hash');
  });

  it('should reject submission with non-existent chainId', async () => {
    const testData = createSubmissionTestData();
    const fakeChainId = '00000000-0000-0000-0000-000000000000';

    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', fakeChainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(res1.status).toBe(201);
    createdSubmissionIds.push(res1.body.id);

    // Second submission with same image (should return 409 conflict)
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
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
      .field('walletAddress', testData1.walletAddress)
      .field('signatureR', testData1.signatureR)
      .field('signatureS', testData1.signatureS)
      .attach('image', testData1.imagePath);

    expect(res1.status).toBe(201);
    createdSubmissionIds.push(res1.body.id);

    // Create valid ECDSA signature for second image using the same signer key
    const verificationInputs2 = prepareImageVerification(testData2.imagePath);
    const signerKey = Secp256r1.Scalar.from(BigInt(SIGNER_PRIVATE_KEY));
    const signature2 = Ecdsa.signHash(verificationInputs2.expectedHash, signerKey.toBigInt());
    const signatureData2 = signature2.toBigInt();

    // Second submission with different image but same user (should return 409)
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData1.walletAddress)
      .field('signatureR', signatureData2.r.toString(16).padStart(64, '0'))
      .field('signatureS', signatureData2.s.toString(16).padStart(64, '0'))
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
      .field('walletAddress', testData1.walletAddress)
      .field('signatureR', testData1.signatureR)
      .field('signatureS', testData1.signatureS)
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
      .field('walletAddress', testData2.walletAddress)
      .field('signatureR', testData2.signatureR)
      .field('signatureS', testData2.signatureS)
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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
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
      status: 'awaiting_review',
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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
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
      .field('walletAddress', testData1.walletAddress)
      .field('signatureR', testData1.signatureR)
      .field('signatureS', testData1.signatureS)
      .attach('image', testData1.imagePath);

    expect(res1.status).toBe(201);
    createdSubmissionIds.push(res1.body.id);

    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', newChainId)
      .field('walletAddress', testData2.walletAddress)
      .field('signatureR', testData2.signatureR)
      .field('signatureS', testData2.signatureS)
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
      .field('walletAddress', testData1.walletAddress)
      .field('signatureR', testData1.signatureR)
      .field('signatureS', testData1.signatureS)
      .attach('image', testData1.imagePath);

    expect(res1.status).toBe(201);
    createdSubmissionIds.push(res1.body.id);

    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', newChainId)
      .field('walletAddress', testData2.walletAddress)
      .field('signatureR', testData2.signatureR)
      .field('signatureS', testData2.signatureS)
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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    createdSubmissionIds.push(createRes.body.id);

    // Query for submissions with 'awaiting_review' status
    const getRes = await request(API_URL).get('/api/submissions?status=awaiting_review');

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBeGreaterThan(0);
    // All returned submissions should have 'awaiting_review' status
    expect(getRes.body.every((sub: any) => sub.status === 'awaiting_review')).toBe(true);
  });

  // todo:
  // it('should enqueue proof generation job on admin approval', async () => {
  //   const testData = createSubmissionTestData();
  //   createdUserAddresses.push(testData.walletAddress);

  //   // Create submission (should enqueue job immediately)
  //   const createRes = await request(API_URL)
  //     .post('/api/submissions')
  //     .field('chainId', chainId)
  //     .field('walletAddress', testData.walletAddress)
  //     .field('signatureR', testData.signatureR)
  //     .field('signatureS', testData.signatureS)
  //     .attach('image', testData.imagePath);

  //   expect(createRes.status).toBe(201);
  //   expect(createRes.body.status).toBe('awaiting_review');
  //   const submissionId = createRes.body.id;
  //   createdSubmissionIds.push(submissionId);

  //   // todo: implement check for jobs after jobs endpoints are set up for the dashboard

  //   // Admin can still approve submission (but job is already enqueued)
  //   const approveRes = await request(API_URL)
  //     .patch(`/api/submissions/${submissionId}`)
  //     .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
  //     .send({ challengeVerified: true });

  //   expect(approveRes.status).toBe(200);
  //   expect(approveRes.body.challengeVerified).toBe(true);
  //   expect(approveRes.body.status).toBe('processing');
  // });

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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
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
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(res.status).toBe(201);
    createdSubmissionIds.push(res.body.id);

    // Check participant count increased
    const updatedRes = await request(API_URL).get(`/api/challenges/${newChallengeId}`);
    expect(updatedRes.body.participantCount).toBe(initialCount + 1);
  });

  // ===== Admin Review Tests =====

  it('should allow admin to approve a submission', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create submission
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    const submissionId = createRes.body.id;
    createdSubmissionIds.push(submissionId);

    // Approve submission
    const approveRes = await request(API_URL)
      .patch(`/api/submissions/${submissionId}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.challengeVerified).toBe(true);
    expect(approveRes.body.status).toBe('processing');
    expect(approveRes.body.failureReason).toBeUndefined();
  });

  it('should allow admin to reject a submission with reason', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create submission
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    const submissionId = createRes.body.id;
    createdSubmissionIds.push(submissionId);

    // Reject submission
    const rejectRes = await request(API_URL)
      .patch(`/api/submissions/${submissionId}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({
        challengeVerified: false,
        failureReason: 'Image is too blurry',
      });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.challengeVerified).toBe(false);
    expect(rejectRes.body.status).toBe('rejected');
    expect(rejectRes.body.failureReason).toBe('Image is too blurry');
  });

  it('should use default failure reason when rejecting without explicit reason', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create submission
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    const submissionId = createRes.body.id;
    createdSubmissionIds.push(submissionId);

    // Reject without explicit failure reason
    const rejectRes = await request(API_URL)
      .patch(`/api/submissions/${submissionId}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: false });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.challengeVerified).toBe(false);
    expect(rejectRes.body.status).toBe('rejected');
    expect(rejectRes.body.failureReason).toBe('Image does not satisfy challenge criteria');
  });

  it('should require challengeVerified field for updates', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create submission
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    const submissionId = createRes.body.id;
    createdSubmissionIds.push(submissionId);

    // Try to update without challengeVerified
    const updateRes = await request(API_URL)
      .patch(`/api/submissions/${submissionId}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({});

    expect(updateRes.status).toBe(400);
    expect(updateRes.body.error.field).toBe('challengeVerified');
  });

  it('should require admin authentication for updating submissions', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create submission
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    const submissionId = createRes.body.id;
    createdSubmissionIds.push(submissionId);

    // Try to update without auth
    const updateRes = await request(API_URL)
      .patch(`/api/submissions/${submissionId}`)
      .send({ challengeVerified: true });

    expect(updateRes.status).toBe(401);
  });

  it('should return 404 when updating non-existent submission', async () => {
    const updateRes = await request(API_URL)
      .patch('/api/submissions/00000000-0000-0000-0000-000000000000')
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    expect(updateRes.status).toBe(404);
  });

  it('should reject review when submission is not in awaiting_review status', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create submission
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    const submissionId = createRes.body.id;
    createdSubmissionIds.push(submissionId);

    // Approve submission (changes status from awaiting_review to processing)
    const approveRes = await request(API_URL)
      .patch(`/api/submissions/${submissionId}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('processing');

    // Try to review again (should fail because status is now processing)
    const secondReviewRes = await request(API_URL)
      .patch(`/api/submissions/${submissionId}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: false, failureReason: 'Changed my mind' });

    expect(secondReviewRes.status).toBe(400);
    expect(secondReviewRes.body.error.field).toBe('status');
    expect(secondReviewRes.body.error.message).toContain('processing');
  });

  it('should require admin authentication for deleting submissions', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create submission
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('walletAddress', testData.walletAddress)
      .field('signatureR', testData.signatureR)
      .field('signatureS', testData.signatureS)
      .attach('image', testData.imagePath);

    expect(createRes.status).toBe(201);
    const submissionId = createRes.body.id;
    createdSubmissionIds.push(submissionId);

    // Try to delete without auth
    const deleteRes = await request(API_URL).delete(`/api/submissions/${submissionId}`);

    expect(deleteRes.status).toBe(401);
  });
});
