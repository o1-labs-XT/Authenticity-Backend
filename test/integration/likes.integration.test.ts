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
  getLikeCount,
} from './utils/test-helpers.js';

// ===== Test Helper Functions =====

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

async function createTestSubmission(chainId: string, walletAddress?: string): Promise<string> {
  const testData = createSubmissionTestData();
  const address = walletAddress || testData.walletAddress;

  const res = await request(API_URL)
    .post('/api/submissions')
    .field('chainId', chainId)
    .field('walletAddress', address)
    .field('signatureR', testData.signatureR)
    .field('signatureS', testData.signatureS)
    .attach('image', testData.imagePath);

  if (res.status !== 201) {
    throw new Error(`Failed to create test submission: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.id;
}

// ===== Integration Tests =====

describe('Likes API Integration', () => {
  let challengeId: string;
  let chainId: string;
  const createdSubmissionIds: string[] = [];
  const createdChallengeIds: string[] = [];
  const createdUserAddresses: string[] = [];

  beforeAll(async () => {
    // Setup: Create a test challenge
    challengeId = await createTestChallenge({
      title: 'Likes Test Challenge',
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
    // Cleanup submissions (will cascade delete likes)
    await Promise.all(
      createdSubmissionIds.map((id) =>
        request(API_URL)
          .delete(`/api/submissions/${id}`)
          .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
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

  // ===== Happy Path Tests =====

  it('should create a like with valid data when user has approved submission', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress, testData2.walletAddress);

    // Create submission 1 (for user1)
    const submissionId1 = await createTestSubmission(chainId, testData1.walletAddress);
    createdSubmissionIds.push(submissionId1);

    // Create submission 2 (for user2, this will be liked by user1)
    const submissionId2 = await createTestSubmission(chainId, testData2.walletAddress);
    createdSubmissionIds.push(submissionId2);

    // Admin approves user1's submission (so they can like)
    await request(API_URL)
      .patch(`/api/submissions/${submissionId1}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    // User1 likes user2's submission
    const res = await request(API_URL)
      .post(`/api/submissions/${submissionId2}/likes`)
      .send({ walletAddress: testData1.walletAddress });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      submissionId: submissionId2,
      walletAddress: testData1.walletAddress,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('should allow user with approved submission to create multiple likes', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    const testData3 = createSubmissionTestData();
    createdUserAddresses.push(
      testData1.walletAddress,
      testData2.walletAddress,
      testData3.walletAddress
    );

    // Create submissions
    const submissionId1 = await createTestSubmission(chainId, testData1.walletAddress);
    const submissionId2 = await createTestSubmission(chainId, testData2.walletAddress);
    const submissionId3 = await createTestSubmission(chainId, testData3.walletAddress);
    createdSubmissionIds.push(submissionId1, submissionId2, submissionId3);

    // Admin approves user1's submission
    await request(API_URL)
      .patch(`/api/submissions/${submissionId1}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    // User1 likes both user2's and user3's submissions
    const res1 = await request(API_URL)
      .post(`/api/submissions/${submissionId2}/likes`)
      .send({ walletAddress: testData1.walletAddress });

    expect(res1.status).toBe(201);

    const res2 = await request(API_URL)
      .post(`/api/submissions/${submissionId3}/likes`)
      .send({ walletAddress: testData1.walletAddress });

    expect(res2.status).toBe(201);
  });

  it('should delete a like successfully', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress, testData2.walletAddress);

    // Create submissions
    const submissionId1 = await createTestSubmission(chainId, testData1.walletAddress);
    const submissionId2 = await createTestSubmission(chainId, testData2.walletAddress);
    createdSubmissionIds.push(submissionId1, submissionId2);

    // Admin approves user1's submission
    await request(API_URL)
      .patch(`/api/submissions/${submissionId1}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    // Create a like
    const createRes = await request(API_URL)
      .post(`/api/submissions/${submissionId2}/likes`)
      .send({ walletAddress: testData1.walletAddress });

    expect(createRes.status).toBe(201);

    // Delete the like
    const deleteRes = await request(API_URL).delete(
      `/api/submissions/${submissionId2}/likes/${testData1.walletAddress}`
    );

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // Verify like was deleted
    const likesRes = await request(API_URL).get(`/api/submissions/${submissionId2}/likes`);
    expect(likesRes.status).toBe(200);
    expect(likesRes.body.length).toBe(0);
  });

  it('should get all likes for a submission', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    const testData3 = createSubmissionTestData();
    createdUserAddresses.push(
      testData1.walletAddress,
      testData2.walletAddress,
      testData3.walletAddress
    );

    // Create submissions for all users
    const submissionId1 = await createTestSubmission(chainId, testData1.walletAddress);
    const submissionId2 = await createTestSubmission(chainId, testData2.walletAddress);
    const submissionId3 = await createTestSubmission(chainId, testData3.walletAddress);
    createdSubmissionIds.push(submissionId1, submissionId2, submissionId3);

    // Admin approves submissions for user2 and user3 (so they can like user1's submission)
    await request(API_URL)
      .patch(`/api/submissions/${submissionId2}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    await request(API_URL)
      .patch(`/api/submissions/${submissionId3}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    // Create multiple likes on user1's submission
    await request(API_URL)
      .post(`/api/submissions/${submissionId1}/likes`)
      .send({ walletAddress: testData2.walletAddress });

    await request(API_URL)
      .post(`/api/submissions/${submissionId1}/likes`)
      .send({ walletAddress: testData3.walletAddress });

    // Get all likes
    const res = await request(API_URL).get(`/api/submissions/${submissionId1}/likes`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ walletAddress: testData2.walletAddress }),
        expect.objectContaining({ walletAddress: testData3.walletAddress }),
      ])
    );
  });

  it('should get like count for a submission', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    const testData3 = createSubmissionTestData();
    createdUserAddresses.push(
      testData1.walletAddress,
      testData2.walletAddress,
      testData3.walletAddress
    );

    // Create submissions for all users
    const submissionId1 = await createTestSubmission(chainId, testData1.walletAddress);
    const submissionId2 = await createTestSubmission(chainId, testData2.walletAddress);
    const submissionId3 = await createTestSubmission(chainId, testData3.walletAddress);
    createdSubmissionIds.push(submissionId1, submissionId2, submissionId3);

    // Initially should have 0 likes
    const initialCount = await getLikeCount(submissionId1);
    expect(initialCount).toBe(0);

    // Admin approves submissions for user2 and user3 (so they can like)
    await request(API_URL)
      .patch(`/api/submissions/${submissionId2}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    await request(API_URL)
      .patch(`/api/submissions/${submissionId3}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    // Create multiple likes
    await request(API_URL)
      .post(`/api/submissions/${submissionId1}/likes`)
      .send({ walletAddress: testData2.walletAddress });

    await request(API_URL)
      .post(`/api/submissions/${submissionId1}/likes`)
      .send({ walletAddress: testData3.walletAddress });

    // Get like count
    const finalCount = await getLikeCount(submissionId1);
    expect(finalCount).toBe(2);
  });

  it('should return empty array for submission with no likes', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create a submission
    const submissionId = await createTestSubmission(chainId, testData.walletAddress);
    createdSubmissionIds.push(submissionId);

    // Get likes (should be empty)
    const res = await request(API_URL).get(`/api/submissions/${submissionId}/likes`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  // ===== Validation Tests =====

  it('should reject duplicate likes (same user, same submission)', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress, testData2.walletAddress);

    // Create submissions
    const submissionId1 = await createTestSubmission(chainId, testData1.walletAddress);
    const submissionId2 = await createTestSubmission(chainId, testData2.walletAddress);
    createdSubmissionIds.push(submissionId1, submissionId2);

    // Admin approves user1's submission
    await request(API_URL)
      .patch(`/api/submissions/${submissionId1}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    // Create first like
    const firstRes = await request(API_URL)
      .post(`/api/submissions/${submissionId2}/likes`)
      .send({ walletAddress: testData1.walletAddress });

    expect(firstRes.status).toBe(201);

    // Try to create duplicate like
    const duplicateRes = await request(API_URL)
      .post(`/api/submissions/${submissionId2}/likes`)
      .send({ walletAddress: testData1.walletAddress });

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error.message).toContain('already liked');
  });

  it('should reject like from user without approved submission', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress, testData2.walletAddress);

    // Create submissions
    const submissionId1 = await createTestSubmission(chainId, testData1.walletAddress);
    const submissionId2 = await createTestSubmission(chainId, testData2.walletAddress);
    createdSubmissionIds.push(submissionId1, submissionId2);

    // Do NOT approve user1's submission

    // Try to create like without approval
    const res = await request(API_URL)
      .post(`/api/submissions/${submissionId2}/likes`)
      .send({ walletAddress: testData1.walletAddress });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('approved submission');
  });

  it('should reject like from user with rejected submission', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress, testData2.walletAddress);

    // Create submissions
    const submissionId1 = await createTestSubmission(chainId, testData1.walletAddress);
    const submissionId2 = await createTestSubmission(chainId, testData2.walletAddress);
    createdSubmissionIds.push(submissionId1, submissionId2);

    // Admin rejects user1's submission
    await request(API_URL)
      .patch(`/api/submissions/${submissionId1}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: false, failureReason: 'Does not meet criteria' });

    // Try to create like with rejected submission
    const res = await request(API_URL)
      .post(`/api/submissions/${submissionId2}/likes`)
      .send({ walletAddress: testData1.walletAddress });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('approved submission');
  });

  it('should reject like from non-existent user', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress);

    // Create submission
    const submissionId = await createTestSubmission(chainId, testData1.walletAddress);
    createdSubmissionIds.push(submissionId);

    // Try to create like with non-existent user (testData2 user never created)
    const res = await request(API_URL)
      .post(`/api/submissions/${submissionId}/likes`)
      .send({ walletAddress: testData2.walletAddress });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('User not found');
  });

  it('should reject like for non-existent submission', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    const fakeSubmissionId = '00000000-0000-0000-0000-000000000000';

    const res = await request(API_URL)
      .post(`/api/submissions/${fakeSubmissionId}/likes`)
      .send({ walletAddress: testData.walletAddress });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Submission');
  });

  it('should reject like without walletAddress', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create submission
    const submissionId = await createTestSubmission(chainId, testData.walletAddress);
    createdSubmissionIds.push(submissionId);

    // Try to create like without walletAddress
    const res = await request(API_URL).post(`/api/submissions/${submissionId}/likes`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('walletAddress');
  });

  it('should reject like with invalid walletAddress format', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create submission
    const submissionId = await createTestSubmission(chainId, testData.walletAddress);
    createdSubmissionIds.push(submissionId);

    // Try to create like with invalid wallet address
    const res = await request(API_URL)
      .post(`/api/submissions/${submissionId}/likes`)
      .send({ walletAddress: 'invalid-wallet-address' });

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('walletAddress');
  });

  // ===== Cascade Delete Tests =====

  it('should cascade delete likes when submission is deleted', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    const testData3 = createSubmissionTestData();
    createdUserAddresses.push(
      testData1.walletAddress,
      testData2.walletAddress,
      testData3.walletAddress
    );

    // Create submissions
    const submissionId1 = await createTestSubmission(chainId, testData1.walletAddress);
    const submissionId2 = await createTestSubmission(chainId, testData2.walletAddress);
    const submissionId3 = await createTestSubmission(chainId, testData3.walletAddress);
    createdSubmissionIds.push(submissionId1, submissionId2, submissionId3);

    // Admin approves user2 and user3 submissions (so they can like)
    await request(API_URL)
      .patch(`/api/submissions/${submissionId2}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    await request(API_URL)
      .patch(`/api/submissions/${submissionId3}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    // Create multiple likes on user1's submission
    await request(API_URL)
      .post(`/api/submissions/${submissionId1}/likes`)
      .send({ walletAddress: testData2.walletAddress });

    await request(API_URL)
      .post(`/api/submissions/${submissionId1}/likes`)
      .send({ walletAddress: testData3.walletAddress });

    // Verify likes exist
    const beforeCount = await getLikeCount(submissionId1);
    expect(beforeCount).toBe(2);

    // Delete submission
    const deleteRes = await request(API_URL)
      .delete(`/api/submissions/${submissionId1}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD);

    expect(deleteRes.status).toBe(204);

    // Remove from cleanup list since we just deleted it
    const index = createdSubmissionIds.indexOf(submissionId1);
    if (index > -1) {
      createdSubmissionIds.splice(index, 1);
    }

    // Verify likes were cascade deleted (404 for submission)
    const afterRes = await request(API_URL).get(`/api/submissions/${submissionId1}/likes`);
    expect(afterRes.status).toBe(404);
  });

  it('should cascade delete likes when user is deleted', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    const testData3 = createSubmissionTestData();
    createdUserAddresses.push(
      testData1.walletAddress,
      testData2.walletAddress,
      testData3.walletAddress
    );

    // Create two separate challenges for user1's two submissions
    const challenge1Id = await createTestChallenge({
      title: 'Cascade Delete Test Challenge 1',
      startDaysFromNow: -1,
      endDaysFromNow: 7,
    });
    const challenge2Id = await createTestChallenge({
      title: 'Cascade Delete Test Challenge 2',
      startDaysFromNow: -1,
      endDaysFromNow: 7,
    });
    createdChallengeIds.push(challenge1Id, challenge2Id);

    // Get chains for the challenges
    const chains1Res = await request(API_URL).get(`/api/chains?challengeId=${challenge1Id}`);
    const chains2Res = await request(API_URL).get(`/api/chains?challengeId=${challenge2Id}`);
    const chain1Id = chains1Res.body[0].id;
    const chain2Id = chains2Res.body[0].id;

    // Create submissions in different challenges
    const submissionId1 = await createTestSubmission(chain1Id, testData1.walletAddress);
    const submissionId2 = await createTestSubmission(chain2Id, testData1.walletAddress);
    const submissionId3 = await createTestSubmission(chainId, testData2.walletAddress);
    createdSubmissionIds.push(submissionId1, submissionId2, submissionId3);

    // Admin approves user2's submission (so they can like)
    await request(API_URL)
      .patch(`/api/submissions/${submissionId3}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    // testData2 user likes both of user1's submissions
    await request(API_URL)
      .post(`/api/submissions/${submissionId1}/likes`)
      .send({ walletAddress: testData2.walletAddress });

    await request(API_URL)
      .post(`/api/submissions/${submissionId2}/likes`)
      .send({ walletAddress: testData2.walletAddress });

    // Verify likes exist
    const count1Before = await getLikeCount(submissionId1);
    const count2Before = await getLikeCount(submissionId2);
    expect(count1Before).toBe(1);
    expect(count2Before).toBe(1);

    // Delete user
    const deleteRes = await request(API_URL)
      .delete(`/api/users/${testData2.walletAddress}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD);

    expect(deleteRes.status).toBe(204);

    // Remove from cleanup list
    const index = createdUserAddresses.indexOf(testData2.walletAddress);
    if (index > -1) {
      createdUserAddresses.splice(index, 1);
    }

    // Verify likes were cascade deleted
    const count1After = await getLikeCount(submissionId1);
    const count2After = await getLikeCount(submissionId2);
    expect(count1After).toBe(0);
    expect(count2After).toBe(0);
  });

  // ===== Edge Cases =====

  it('should return 404 when deleting non-existent like', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    createdUserAddresses.push(testData1.walletAddress, testData2.walletAddress);

    // Create submission (but no like)
    const submissionId = await createTestSubmission(chainId, testData1.walletAddress);
    createdSubmissionIds.push(submissionId);

    // Try to delete non-existent like
    const res = await request(API_URL).delete(
      `/api/submissions/${submissionId}/likes/${testData2.walletAddress}`
    );

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Like not found');
  });

  it('should return 404 when getting likes for non-existent submission', async () => {
    const fakeSubmissionId = '00000000-0000-0000-0000-000000000000';

    const res = await request(API_URL).get(`/api/submissions/${fakeSubmissionId}/likes`);

    expect(res.status).toBe(404);
  });

  it('should return 404 when getting like count for non-existent submission', async () => {
    const fakeSubmissionId = '00000000-0000-0000-0000-000000000000';

    const res = await request(API_URL).get(`/api/submissions/${fakeSubmissionId}/likes/count`);

    expect(res.status).toBe(404);
  });

  it('should handle multiple users liking different submissions', async () => {
    const testData1 = createSubmissionTestData();
    const testData2 = createSubmissionTestData();
    const testData3 = createSubmissionTestData();
    createdUserAddresses.push(
      testData1.walletAddress,
      testData2.walletAddress,
      testData3.walletAddress
    );

    // Create multiple submissions
    const submissionId1 = await createTestSubmission(chainId, testData1.walletAddress);
    const submissionId2 = await createTestSubmission(chainId, testData2.walletAddress);
    const submissionId3 = await createTestSubmission(chainId, testData3.walletAddress);
    createdSubmissionIds.push(submissionId1, submissionId2, submissionId3);

    // Admin approves user2 and user3 submissions (so they can like)
    await request(API_URL)
      .patch(`/api/submissions/${submissionId2}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    await request(API_URL)
      .patch(`/api/submissions/${submissionId3}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    // User 2 likes submission 1
    await request(API_URL)
      .post(`/api/submissions/${submissionId1}/likes`)
      .send({ walletAddress: testData2.walletAddress });

    // User 3 likes both submission 1 and submission 2
    await request(API_URL)
      .post(`/api/submissions/${submissionId1}/likes`)
      .send({ walletAddress: testData3.walletAddress });

    await request(API_URL)
      .post(`/api/submissions/${submissionId2}/likes`)
      .send({ walletAddress: testData3.walletAddress });

    // Verify counts
    const count1 = await getLikeCount(submissionId1);
    const count2 = await getLikeCount(submissionId2);
    expect(count1).toBe(2);
    expect(count2).toBe(1);

    // Verify individual likes
    const likes1 = await request(API_URL).get(`/api/submissions/${submissionId1}/likes`);
    expect(likes1.body.length).toBe(2);

    const likes2 = await request(API_URL).get(`/api/submissions/${submissionId2}/likes`);
    expect(likes2.body.length).toBe(1);
    expect(likes2.body[0].walletAddress).toBe(testData3.walletAddress);
  });

  it('should allow user to like their own submission if approved', async () => {
    const testData = createSubmissionTestData();
    createdUserAddresses.push(testData.walletAddress);

    // Create submission
    const submissionId = await createTestSubmission(chainId, testData.walletAddress);
    createdSubmissionIds.push(submissionId);

    // Admin approves the submission
    await request(API_URL)
      .patch(`/api/submissions/${submissionId}`)
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({ challengeVerified: true });

    // User likes their own submission
    const res = await request(API_URL)
      .post(`/api/submissions/${submissionId}/likes`)
      .send({ walletAddress: testData.walletAddress });

    expect(res.status).toBe(201);
    expect(res.body.walletAddress).toBe(testData.walletAddress);

    // Verify count
    const count = await getLikeCount(submissionId);
    expect(count).toBe(1);
  });
});
