# Submissions Resource Implementation Plan

## 🎯 IMPLEMENTATION STATUS (Updated 2025-10-04)

### ✅ COMPLETED COMPONENTS

| Step | Component | Status | Tests | Notes |
|------|-----------|--------|-------|-------|
| - | **Database Migration** | ✅ Complete | N/A | `20250924023134_create_submissions_table.ts` |
| 2 | **Database Repository** | ✅ Complete | ⚠️ Unit tests missing | Basic CRUD + transaction support |
| 4 | **Handler Layer** | ✅ Complete | ⚠️ Unit tests missing | Full validation & error handling |
| 6 | **Routes Layer** | ✅ Complete | N/A | Registered at `/api/submissions` |
| 8 | **Server Integration** | ✅ Complete | N/A | Fully integrated in `src/index.ts` |
| 1 | **Integration Tests** | ✅ Complete | ✅ **23/23 passing** | Comprehensive coverage |

**Key Implementation Notes:**
- ✅ Duplicate detection handled via DB unique constraint on `sha256_hash`
- ✅ One submission per user per challenge enforced via unique constraint `(wallet_address, challenge_id)`
- ✅ Participant count always increments (each submission = new participant due to unique constraint)
- ✅ Token owner fields intentionally removed from schema
- ✅ Chain length and participant count updated atomically via database transactions

### ❌ INCOMPLETE / BLOCKED COMPONENTS

| Step | Component | Status | Priority | Blocker |
|------|-----------|--------|----------|---------|
| 3 | **Repository Unit Tests** | ❌ Not Started | Medium | - |
| 5 | **Handler Unit Tests** | ❌ Not Started | Medium | - |
| 7 | **Worker Modifications** | ❌ Not Started | **🔴 CRITICAL** | Blocks proof generation |
| 9 | **Worker Integration** | ❌ Not Started | **🔴 CRITICAL** | Depends on Step 7 |
| - | **Admin Review PATCH Endpoint** | ✅ Complete | - | Integration tests passing |
| - | **Job Queue Integration** | ⚠️ Commented Out | **🔴 CRITICAL** | TODO in handler |
| 10 | **Upload Deprecation** | ❌ Not Started | Low | Can defer |

### 🔴 CRITICAL BLOCKERS

1. **Job Queue Disabled**: Proof generation enqueueing is commented out in handler
   - Current state: Submissions created but no async processing happens
   - Impact: Photos uploaded and admin-approved but never get proofs generated or published to blockchain

2. **Worker Not Updated**: Worker still uses `AuthenticityRepository` instead of `SubmissionsRepository`
   - Location: `src/workers/proofGenerationWorker.ts`
   - Impact: Even if jobs were enqueued, worker couldn't process them

3. ✅ **Admin Review Flow** - IMPLEMENTED
   - `PATCH /api/submissions/:id` with `{ challengeVerified: true/false, failureReason? }`
   - Admin can approve (→ `processing`) or reject (→ `rejected`) submissions
   - Protected by `requireAdmin` middleware (basic auth)

### 🟡 NON-CRITICAL ITEMS

- Repository unit tests (Step 3) - integration tests provide coverage
- Handler unit tests (Step 5) - integration tests provide coverage
- Upload endpoint deprecation (Step 10) - can be done later

### 📊 IMPLEMENTATION PROGRESS: 75%

- **Core API (CRUD)**: 100% ✅ (All endpoints working including PATCH)
- **Database Layer**: 100% ✅ (Migrations, repository, constraints)
- **Testing**: 75% ⚠️ (Integration ✅ with admin tests, Unit tests ❌)
- **Async Processing**: 0% ❌ (Job queue disabled, worker not updated)
- **Admin Workflow**: 100% ✅ (PATCH endpoint implemented with auth)

### 🎯 NEXT STEPS (Priority Order)

1. **Enable job queue** in handler (uncomment TODO, trigger on admin approval)
2. **Update worker** to use `SubmissionsRepository` and handle `processing` → `complete` state
3. **Worker should set `status = 'complete'`** when transaction gets 5 confirmations
4. **Add unit tests** for repository and handler (optional, low priority)

---

## Overview

This document provides a detailed, step-by-step implementation plan for building the **Submissions** resource, which will replace the existing `authenticity_records` table and `/api/upload` endpoint in the TouchGrass MVP.

### Key Changes

1. **New Resource**: `submissions` - replaces `authenticity_records`
2. **New Endpoint**: `POST /api/submissions` - replaces `POST /api/upload`
3. **Chain Integration**: Submissions are linked to chains and challenges
4. **User Tracking**: Submissions are linked to users via wallet address
5. **Position Tracking**: Each submission has a `chain_position` within its chain
6. **Admin Review**: Submissions require admin approval before blockchain publishing
7. **Extended Status Flow**: `uploading` → `verifying` → `awaiting_review` → `publishing` → `confirming` → `verified`
8. **No Token Owner**: Token owner fields removed from design (simplified)

### Design Principles

- **Test-Driven Development**: Write integration tests first, then unit tests, then implementation
- **Reuse Existing Logic**: Leverage upload handler's signature verification and job queueing
- **Maintain Patterns**: Follow the same patterns as challenges, users, and chains resources
- **Clean Architecture**: Repository → Handler → Routes → Server
- **Comprehensive Error Handling**: Field-specific validation errors
- **Transaction Safety**: Use database transactions for atomic operations

---

## Submission Flow Overview

### Simplified 4-State Machine

```typescript
export type SubmissionStatus =
  | 'awaiting_review'  // Awaiting admin review
  | 'rejected'         // Admin rejected (terminal)
  | 'processing'       // Proof generation → tx submission → confirmations
  | 'complete';        // Tx confirmed 5 times (terminal)
```

### Complete User Flow

1. **User uploads photo** - ✅ IMPLEMENTED
   - Client generates SHA256 hash and signs it with their Mina key
   - Client uploads: image file, signature, wallet address (public key), chainId, tagline (optional)
   - Server validates signature, stores image in MinIO, creates submission record
   - **Initial Status**: `awaiting_review`

2. **Admin reviews submission** - ✅ IMPLEMENTED
   - Admin views submission in dashboard
   - Admin checks if image meets challenge criteria (e.g., "photo of grass")
   - **Approval**: `PATCH /api/submissions/:id { challengeVerified: true }`
     - Sets `challenge_verified = true`
     - Sets `status = 'processing'`
     - Clears `failure_reason = null`
     - TODO: Enqueues job for proof generation
   - **Rejection**: `PATCH /api/submissions/:id { challengeVerified: false, failureReason: "..." }`
     - Sets `challenge_verified = false`
     - Sets `status = 'rejected'` (terminal)
     - Sets `failure_reason` with admin's explanation

3. **Worker processes approved submission** - ❌ NOT IMPLEMENTED
   - Job queue triggers worker when admin approves
   - Worker generates ZK proof of authenticity
   - Worker publishes proof to blockchain
   - Worker sets `transaction_id` after submission
   - Worker waits for 5 confirmations
   - **Status**: `processing` (throughout entire workflow)
   - **Note**: If worker encounters errors, `failure_reason` is set but status remains `processing`

4. **Transaction confirmed** - ❌ NOT IMPLEMENTED
   - Worker detects 5 blockchain confirmations
   - Sets `status = 'complete'` (terminal)

### State Machine Diagram

```
awaiting_review ──[admin approves]──> processing ──[5 confirmations]──> complete (terminal)
       │
       └──[admin rejects]──> rejected (terminal)
```

**Current Implementation:**
```
awaiting_review ──[PATCH approved]──> processing (stuck, job queue disabled)
       │
       └──[PATCH rejected]──> rejected ✅
```

### State Descriptions

#### `awaiting_review`
- **When**: Initial state after successful upload
- **Description**: Waiting for admin to review the image
- **Fields**: `challenge_verified = false`, no `transaction_id`, no `failure_reason`

#### `rejected` (terminal state)
- **When**: Admin rejects the submission
- **Description**: Image does not meet challenge criteria
- **Fields**:
  - `challenge_verified = false`
  - `failure_reason` contains admin's rejection explanation
  - No `transaction_id` (never goes to blockchain)

#### `processing`
- **When**: Admin approves the submission
- **Description**: Worker is:
  1. Generating ZK proof of authenticity
  2. Publishing proof to blockchain
  3. Waiting for transaction confirmations (0-5)
- **Fields**:
  - `challenge_verified = true`
  - `transaction_id` set after tx submission (null before)
  - `failure_reason` set if worker errors occur (otherwise null)

#### `complete` (terminal state)
- **When**: Transaction receives 5 confirmations on-chain
- **Description**: Submission successfully verified and published
- **Fields**:
  - `challenge_verified = true`
  - `transaction_id` contains blockchain transaction ID
  - No `failure_reason`

---

## Database Schema ✅ IMPLEMENTED

The `submissions` table migration exists at `/migrations/20250924023134_create_submissions_table.ts`:

```sql
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256_hash VARCHAR(64) NOT NULL UNIQUE,                    -- Unique image hash
  wallet_address VARCHAR(255) NOT NULL,                       -- FK to users (public key)
  signature VARCHAR(500) NOT NULL,                            -- Signature of image hash
  challenge_id UUID NOT NULL,                                 -- FK to challenges
  chain_id UUID NOT NULL,                                     -- FK to chains
  storage_key VARCHAR(255) NOT NULL,                          -- MinIO object key
  tagline VARCHAR(255) NULL,                                  -- User's tagline
  chain_position INTEGER NOT NULL,                            -- Position in chain
  status ENUM(
    'uploading', 'verifying', 'awaiting_review', 'rejected',
    'publishing', 'confirming', 'verified', 'pending_position',
    'complete', 'failed'
  ) NOT NULL DEFAULT 'uploading',
  transaction_id VARCHAR(255) NULL,                           -- Blockchain tx ID
  failure_reason TEXT NULL,                                   -- Rejection/error reason
  retry_count INTEGER NOT NULL DEFAULT 0,                     -- Retry attempts
  challenge_verified BOOLEAN NOT NULL DEFAULT false,          -- Admin approval flag
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Foreign keys
  FOREIGN KEY (wallet_address) REFERENCES users(wallet_address) ON DELETE CASCADE,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
  FOREIGN KEY (chain_id) REFERENCES chains(id) ON DELETE CASCADE,

  -- Indexes
  INDEX (wallet_address),
  INDEX (challenge_id),
  INDEX (chain_id),
  INDEX (sha256_hash),
  INDEX (status),
  INDEX (created_at),

  -- Constraints
  UNIQUE (wallet_address, challenge_id)  -- One submission per user per challenge
);
```

### Key Schema Features ✅

1. **UUID Primary Key**: Auto-generated unique identifier
2. **Duplicate Prevention**: Unique constraint on `sha256_hash` prevents same image uploaded twice
3. **One Submission Per Challenge**: Unique constraint on `(wallet_address, challenge_id)`
4. **Foreign Keys**: Cascading deletes maintain referential integrity
5. **Extended Status Enum**: 10 states covering entire submission lifecycle
6. **Review Tracking**: `challenge_verified` boolean for admin approval workflow
7. **Timestamps**: Automatic creation and update tracking via `created_at`/`updated_at`
8. **Indexes**: Optimized for common query patterns (wallet, chain, challenge, hash, status)
9. **No Token Owner**: Simplified design - no separate token owner fields needed

---

## New Admin Endpoints Required

### Admin Review Endpoints (RESTful)

Following REST best practices, we'll use resource-oriented endpoints with proper HTTP verbs:

1. **GET /api/submissions?status=awaiting_review**
   - List submissions filtered by status
   - Sorting: `?sort=created_at&order=desc`
   - Filter by status: `?status=awaiting_review` or `?status=rejected`
   - Returns: Array of submissions with image URLs for preview
   - **Note**: This is the same endpoint as the general GET /api/submissions, just filtered

2. **PATCH /api/submissions/:id**
   - Update submission (used for admin approval/rejection)
   - Body for approval:
     ```json
     {
       "challengeVerified": true
     }
     ```
   - Body for rejection:
     ```json
     {
       "challengeVerified": false,
       "failureReason": "Image does not meet challenge criteria"
     }
     ```
   - Updates: `challenge_verified`, `status`, `failure_reason`
   - Triggers: Blockchain publishing worker job (on approval only)
   - Returns: Updated submission resource

### Admin Handler Methods

Add to `SubmissionsHandler`:

```typescript
async updateSubmission(req: Request, res: Response, next: NextFunction): Promise<void>
// Handles admin review (approval/rejection)
// Validates admin permissions for review-related fields
```

---

## Step 1: Integration Tests (TDD Approach)

**File**: `test/integration/submissions.integration.test.ts`

Write comprehensive integration tests first. These tests will drive the implementation and ensure all requirements are met.

### Test Structure

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { PrivateKey, Signature, Field } from 'o1js';
import fs from 'fs';
import path from 'path';
import {
  API_URL,
  createTestChallenge,
  cleanupChallenges,
} from './utils/test-helpers.js';

describe('Submissions API Integration', () => {
  let challengeId: string;
  let chainId: string;
  let walletAddress: string;
  let privateKey: PrivateKey;
  let publicKey: string;
  let testImagePath: string;
  let testImageBuffer: Buffer;
  let signature: string;
  const createdSubmissionIds: string[] = [];
  const createdChallengeIds: string[] = [];

  beforeAll(async () => {
    // Setup: Create a test challenge
    challengeId = await createTestChallenge({
      title: 'Submissions Test Challenge',
      startDaysFromNow: -1,
      endDaysFromNow: 7,
    });
    createdChallengeIds.push(challengeId);

    // Get the default chain for this challenge
    const chainsRes = await request(API_URL).get(
      `/api/chains?challengeId=${challengeId}`
    );
    expect(chainsRes.status).toBe(200);
    expect(chainsRes.body.length).toBeGreaterThan(0);
    chainId = chainsRes.body[0].id;

    // Setup: Create test user wallet
    privateKey = PrivateKey.random();
    publicKey = privateKey.toPublicKey().toBase58();
    walletAddress = publicKey;

    // Create user
    const userRes = await request(API_URL)
      .post('/api/users')
      .send({ walletAddress });
    expect([200, 201]).toContain(userRes.status);

    // Setup: Create test image
    testImagePath = path.join('/tmp', 'test-submission-image.png');
    testImageBuffer = Buffer.from('fake image data for testing');
    fs.writeFileSync(testImagePath, testImageBuffer);

    // Setup: Sign the image
    const imageHash = Field.from(123456); // In real test, hash the actual image
    signature = Signature.create(privateKey, [imageHash]).toBase58();
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
  });

  afterAll(async () => {
    // Cleanup test image
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
    // Cleanup challenges (cascades to chains)
    await cleanupChallenges(createdChallengeIds);
  });

  // Test 1: Successful submission creation
  it('should create a submission with valid data', async () => {
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .field('tagline', 'My first submission!')
      .attach('image', testImagePath);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      sha256Hash: expect.any(String),
      walletAddress: walletAddress,
      tokenOwnerAddress: expect.any(String),
      challengeId: challengeId,
      chainId: chainId,
      tagline: 'My first submission!',
      chainPosition: 1, // First submission in chain
      status: 'pending',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    createdSubmissionIds.push(res.body.id);
  });

  // Test 2: Missing required fields
  it('should reject submission without image', async () => {
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('image');
  });

  it('should reject submission without chainId', async () => {
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('chainId');
  });

  it('should reject submission without publicKey', async () => {
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('publicKey');
  });

  it('should reject submission without signature', async () => {
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .attach('image', testImagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('signature');
  });

  // Test 3: Invalid formats
  it('should reject invalid publicKey format', async () => {
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', 'invalid-key')
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('publicKey');
    expect(res.body.error.message).toContain('Invalid');
  });

  it('should reject invalid signature format', async () => {
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', 'invalid-signature')
      .attach('image', testImagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('signature');
  });

  it('should reject invalid chainId format', async () => {
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', 'not-a-uuid')
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('chainId');
  });

  // Test 4: Non-existent references
  it('should reject submission with non-existent chainId', async () => {
    const fakeChainId = '00000000-0000-0000-0000-000000000000';
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', fakeChainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Chain');
  });

  // Test 5: Duplicate submission constraint
  it('should reject duplicate submission for same user and challenge', async () => {
    // First submission
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res1.status).toBe(201);
    createdSubmissionIds.push(res1.body.id);

    // Second submission (should fail)
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res2.status).toBe(409);
    expect(res2.body.error.message).toContain('already submitted');
  });

  // Test 6: Duplicate image detection
  it('should detect duplicate image and return existing submission', async () => {
    // First submission
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res1.status).toBe(201);
    const originalHash = res1.body.sha256Hash;
    createdSubmissionIds.push(res1.body.id);

    // Try to submit same image again (should return existing)
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res2.status).toBe(200); // 200 for existing
    expect(res2.body.sha256Hash).toBe(originalHash);
    expect(res2.body.status).toBe('duplicate');
  });

  // Test 7: Chain position increment
  it('should increment chain position for sequential submissions', async () => {
    // Create multiple users and submit to same chain
    const user2Key = PrivateKey.random();
    const user2Address = user2Key.toPublicKey().toBase58();
    await request(API_URL)
      .post('/api/users')
      .send({ walletAddress: user2Address });

    // First submission
    const res1 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res1.body.chainPosition).toBe(1);
    createdSubmissionIds.push(res1.body.id);

    // Second submission from different user
    const sig2 = Signature.create(user2Key, [Field.from(789)]).toBase58();
    const res2 = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', user2Address)
      .field('signature', sig2)
      .attach('image', testImagePath);

    expect(res2.body.chainPosition).toBe(2);
    createdSubmissionIds.push(res2.body.id);
  });

  // Test 8: GET submission by ID
  it('should retrieve a submission by ID', async () => {
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .field('tagline', 'Test GET')
      .attach('image', testImagePath);

    expect(createRes.status).toBe(201);
    const submissionId = createRes.body.id;
    createdSubmissionIds.push(submissionId);

    const getRes = await request(API_URL).get(`/api/submissions/${submissionId}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: submissionId,
      tagline: 'Test GET',
      status: 'pending',
    });
  });

  // Test 9: GET submissions by wallet address
  it('should retrieve submissions for a wallet address', async () => {
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(createRes.status).toBe(201);
    createdSubmissionIds.push(createRes.body.id);

    const getRes = await request(API_URL).get(
      `/api/submissions?walletAddress=${walletAddress}`
    );

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBeGreaterThan(0);
    expect(getRes.body[0].walletAddress).toBe(walletAddress);
  });

  // Test 10: GET submissions by chain
  it('should retrieve submissions for a chain', async () => {
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(createRes.status).toBe(201);
    createdSubmissionIds.push(createRes.body.id);

    const getRes = await request(API_URL).get(`/api/submissions?chainId=${chainId}`);

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBeGreaterThan(0);
    expect(getRes.body[0].chainId).toBe(chainId);
  });

  // Test 11: GET submissions by challenge
  it('should retrieve submissions for a challenge', async () => {
    const createRes = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(createRes.status).toBe(201);
    createdSubmissionIds.push(createRes.body.id);

    const getRes = await request(API_URL).get(
      `/api/submissions?challengeId=${challengeId}`
    );

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBeGreaterThan(0);
    expect(getRes.body[0].challengeId).toBe(challengeId);
  });

  // Test 12: Response shape validation
  it('should return properly formatted response with camelCase fields', async () => {
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .field('tagline', 'Shape test')
      .attach('image', testImagePath);

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
      status: 'pending',
      retryCount: 0,
      challengeVerified: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    // Should NOT include private key in response
    expect(res.body.tokenOwnerPrivateKey).toBeUndefined();

    createdSubmissionIds.push(res.body.id);
  });

  // Test 13: Job queue integration
  it('should enqueue proof generation job after submission', async () => {
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res.status).toBe(201);
    createdSubmissionIds.push(res.body.id);

    // Wait a bit for async job enqueueing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check job queue stats
    const statsRes = await request(API_URL).get('/api/admin/jobs/stats');
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.total).toBeGreaterThan(0);
  });

  // Test 14: Chain length update
  it('should update chain length when submission is created', async () => {
    // Get initial chain length
    const initialRes = await request(API_URL).get(`/api/chains/${chainId}`);
    const initialLength = initialRes.body.length;

    // Create submission
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', chainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res.status).toBe(201);
    createdSubmissionIds.push(res.body.id);

    // Check chain length increased
    const updatedRes = await request(API_URL).get(`/api/chains/${chainId}`);
    expect(updatedRes.body.length).toBe(initialLength + 1);
  });

  // Test 15: Challenge participant count update
  it('should increment challenge participant count on first submission', async () => {
    // Create a fresh challenge
    const newChallengeId = await createTestChallenge({
      title: 'Participant Count Test',
      startDaysFromNow: -1,
      endDaysFromNow: 7,
    });
    createdChallengeIds.push(newChallengeId);

    // Get its default chain
    const chainsRes = await request(API_URL).get(
      `/api/chains?challengeId=${newChallengeId}`
    );
    const newChainId = chainsRes.body[0].id;

    // Get initial participant count
    const initialRes = await request(API_URL).get(
      `/api/challenges/${newChallengeId}`
    );
    const initialCount = initialRes.body.participantCount;

    // Create submission
    const res = await request(API_URL)
      .post('/api/submissions')
      .field('chainId', newChainId)
      .field('publicKey', publicKey)
      .field('signature', signature)
      .attach('image', testImagePath);

    expect(res.status).toBe(201);
    createdSubmissionIds.push(res.body.id);

    // Check participant count increased
    const updatedRes = await request(API_URL).get(
      `/api/challenges/${newChallengeId}`
    );
    expect(updatedRes.body.participantCount).toBe(initialCount + 1);
  });
});
```

### Test Helpers Addition

Add to `test/integration/utils/test-helpers.ts`:

```typescript
/**
 * Cleanup test submissions, ignoring errors
 */
export const cleanupSubmissions = async (ids: string[]): Promise<void> => {
  await Promise.all(
    ids.map((id) =>
      request(API_URL)
        .delete(`/api/submissions/${id}`)
        .catch(() => {})
    )
  );
};

/**
 * Create a test user for integration testing
 */
export const createTestUser = async (walletAddress?: string): Promise<string> => {
  const address = walletAddress || PrivateKey.random().toPublicKey().toBase58();
  const res = await request(API_URL).post('/api/users').send({ walletAddress: address });

  if (![200, 201].includes(res.status)) {
    throw new Error(`Failed to create test user: ${res.status}`);
  }

  return address;
};
```

---

## Step 2: Database Repository Layer

**File**: `src/db/repositories/submissions.repository.ts`

Implement the repository following the existing patterns from other repositories.

```typescript
import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { Submission } from '../types/touchgrass.types.js';
import { Knex } from 'knex';
import { Errors } from '../../utils/errors.js';

export interface CreateSubmissionInput {
  sha256Hash: string;
  walletAddress: string;        // User's wallet address (public key)
  signature: string;
  challengeId: string;
  chainId: string;
  storageKey: string;            // MinIO object key
  tagline?: string;
  // Note: chainPosition calculated automatically in transaction
}

export class SubmissionsRepository {
  constructor(private readonly db: PostgresAdapter) {}

  /**
   * Create a new submission with all related updates in a transaction
   */
  async create(input: CreateSubmissionInput): Promise<Submission> {
    const knex = this.db.getKnex();

    try {
      const submission = await knex.transaction(async (trx: Knex.Transaction) => {
        // 1. Get next chain position
        const result = await trx('submissions')
          .where('chain_id', input.chainId)
          .max('chain_position as max_position')
          .first();
        const chainPosition = (result?.max_position || 0) + 1;

        // 2. Insert submission
        const [newSubmission] = await trx('submissions')
          .insert({
            sha256_hash: input.sha256Hash,
            wallet_address: input.walletAddress,
            signature: input.signature,
            challenge_id: input.challengeId,
            chain_id: input.chainId,
            storage_key: input.storageKey,
            tagline: input.tagline,
            chain_position: chainPosition,
            status: 'uploading',
          })
          .returning('*');

        // 3. Update chain length and last_activity_at
        await trx('chains')
          .where('id', input.chainId)
          .increment('length', 1)
          .update({ last_activity_at: knex.fn.now() });

        // 4. Increment challenge participant count
        // Note: Due to unique constraint (wallet_address, challenge_id),
        // each successful submission is guaranteed to be a new participant
        await trx('challenges')
          .where('id', input.challengeId)
          .increment('participant_count', 1);

        return newSubmission;
      });

      return submission;
    } catch (error) {
      // Handle unique constraint violations
      if (error instanceof Error && 'code' in error) {
        const dbError = error as Error & { code: string; constraint?: string };
        if (dbError.code === '23505') {
          // PostgreSQL unique violation
          if (dbError.constraint?.includes('sha256_hash')) {
            throw Errors.conflict('Image already submitted');
          }
          if (dbError.constraint?.includes('wallet_address_challenge_id')) {
            throw Errors.conflict('You have already submitted to this challenge');
          }
        }
        // Foreign key violation
        if (dbError.code === '23503') {
          throw Errors.notFound('Chain or Challenge not found');
        }
      }
      throw error;
    }
  }

  /**
   * Find submission by ID
   */
  async findById(id: string): Promise<Submission | null> {
    const result = await this.db.getKnex()('submissions').where('id', id).first();
    return result || null;
  }

  /**
   * Find submission by SHA256 hash
   */
  async findByHash(sha256Hash: string): Promise<Submission | null> {
    const result = await this.db
      .getKnex()('submissions')
      .where('sha256_hash', sha256Hash)
      .first();
    return result || null;
  }

  /**
   * Find submissions by wallet address
   */
  async findByWalletAddress(walletAddress: string): Promise<Submission[]> {
    return this.db
      .getKnex()('submissions')
      .where('wallet_address', walletAddress)
      .orderBy('created_at', 'desc');
  }

  /**
   * Find submissions by chain ID
   */
  async findByChainId(chainId: string): Promise<Submission[]> {
    return this.db
      .getKnex()('submissions')
      .where('chain_id', chainId)
      .orderBy('chain_position', 'asc');
  }

  /**
   * Find submissions by challenge ID
   */
  async findByChallengeId(challengeId: string): Promise<Submission[]> {
    return this.db
      .getKnex()('submissions')
      .where('challenge_id', challengeId)
      .orderBy('created_at', 'desc');
  }

  /**
   * Get all submissions with optional filters
   */
  async findAll(options?: {
    walletAddress?: string;
    chainId?: string;
    challengeId?: string;
    status?: string;
  }): Promise<Submission[]> {
    let query = this.db.getKnex()('submissions');

    if (options?.walletAddress) {
      query = query.where('wallet_address', options.walletAddress);
    }
    if (options?.chainId) {
      query = query.where('chain_id', options.chainId);
    }
    if (options?.challengeId) {
      query = query.where('challenge_id', options.challengeId);
    }
    if (options?.status) {
      query = query.where('status', options.status);
    }

    return query.orderBy('created_at', 'desc');
  }

  /**
   * Check if user has already submitted to a challenge
   */
  async hasSubmittedToChallenge(
    walletAddress: string,
    challengeId: string
  ): Promise<boolean> {
    const result = await this.db
      .getKnex()('submissions')
      .where('wallet_address', walletAddress)
      .where('challenge_id', challengeId)
      .first();

    return !!result;
  }

  /**
   * Get next chain position for a chain
   */
  async getNextChainPosition(chainId: string): Promise<number> {
    const result = await this.db
      .getKnex()('submissions')
      .where('chain_id', chainId)
      .max('chain_position as max_position')
      .first();

    return (result?.max_position || 0) + 1;
  }

  /**
   * Update submission status and related fields
   */
  async updateStatus(
    id: string,
    updates: {
      status: Submission['status'];
      transactionId?: string;
      failureReason?: string;
      retryCount?: number;
    }
  ): Promise<void> {
    await this.db
      .getKnex()('submissions')
      .where('id', id)
      .update({
        status: updates.status,
        transaction_id: updates.transactionId,
        failure_reason: updates.failureReason,
        retry_count: updates.retryCount,
        updated_at: this.db.getKnex().fn.now(),
      });
  }

  /**
   * Update submission with arbitrary fields
   */
  async update(id: string, updates: Partial<Submission>): Promise<void> {
    await this.db
      .getKnex()('submissions')
      .where('id', id)
      .update({
        ...updates,
        updated_at: this.db.getKnex().fn.now(),
      });
  }

  /**
   * Delete submission (admin only, for testing)
   */
  async delete(id: string): Promise<boolean> {
    const deleted = await this.db.getKnex()('submissions').where('id', id).delete();
    return deleted > 0;
  }

  /**
   * Get submission count for a wallet
   */
  async getCountByWallet(walletAddress: string): Promise<number> {
    const result = await this.db
      .getKnex()('submissions')
      .where('wallet_address', walletAddress)
      .count('* as count')
      .first();

    return Number(result?.count || 0);
  }

  /**
   * Get submission count for a chain
   */
  async getCountByChain(chainId: string): Promise<number> {
    const result = await this.db
      .getKnex()('submissions')
      .where('chain_id', chainId)
      .count('* as count')
      .first();

    return Number(result?.count || 0);
  }
}
```

---

## Step 3: Unit Tests for Repository

**File**: `test/repositories/submissions.repository.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubmissionsRepository } from '../../src/db/repositories/submissions.repository.js';
import { PostgresAdapter } from '../../src/db/adapters/PostgresAdapter.js';
import { config } from '../../src/config/index.js';

describe('SubmissionsRepository', () => {
  let repo: SubmissionsRepository;
  let adapter: PostgresAdapter;
  let testSubmissionId: string;
  let testWalletAddress: string;
  let testChallengeId: string;
  let testChainId: string;

  beforeEach(async () => {
    adapter = new PostgresAdapter(config.databaseUrl);
    repo = new SubmissionsRepository(adapter);

    // Setup test data (challenge, chain, user)
    // ... implementation similar to integration tests
  });

  afterEach(async () => {
    // Cleanup test data
  });

  it('should create a submission', async () => {
    const submission = await repo.create({
      sha256Hash: 'test-hash-123',
      walletAddress: testWalletAddress,
      tokenOwnerAddress: 'test-token-owner',
      tokenOwnerPrivateKey: 'test-private-key',
      publicKey: 'test-public-key',
      signature: 'test-signature',
      challengeId: testChallengeId,
      chainId: testChainId,
      chainPosition: 1,
    });

    expect(submission.id).toBeDefined();
    testSubmissionId = submission.id;
  });

  it('should find submission by ID', async () => {
    const submission = await repo.findById(testSubmissionId);
    expect(submission).not.toBeNull();
    expect(submission?.id).toBe(testSubmissionId);
  });

  it('should detect duplicate challenge submission', async () => {
    await expect(
      repo.create({
        sha256Hash: 'different-hash',
        walletAddress: testWalletAddress,
        tokenOwnerAddress: 'test-token-owner',
        tokenOwnerPrivateKey: 'test-private-key',
        publicKey: 'test-public-key',
        signature: 'test-signature',
        challengeId: testChallengeId,
        chainId: testChainId,
        chainPosition: 2,
      })
    ).rejects.toThrow('already submitted');
  });

  // Add more repository-specific tests...
});
```

---

## Step 4: Handler Layer

**File**: `src/handlers/submissions.handler.ts`

Implement the handler following patterns from challenges, users, and upload handlers.

```typescript
import { Request, Response, NextFunction } from 'express';
import type {} from 'multer';
import { PublicKey, Signature, PrivateKey } from 'o1js';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { UsersRepository } from '../db/repositories/users.repository.js';
import { ChainsRepository } from '../db/repositories/chains.repository.js';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import { ImageAuthenticityService } from '../services/image/verification.service.js';
import { JobQueueService } from '../services/queue/jobQueue.service.js';
import { MinioStorageService } from '../services/storage/minio.service.js';
import { Submission } from '../db/types/touchgrass.types.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';

export interface SubmissionResponse {
  id: string;
  sha256Hash: string;
  walletAddress: string;        // User's wallet address (public key)
  signature: string;
  challengeId: string;
  chainId: string;
  storageKey: string;
  tagline?: string;
  chainPosition: number;
  status: string;
  transactionId?: string;
  failureReason?: string;
  retryCount: number;
  challengeVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class SubmissionsHandler {
  constructor(
    private readonly submissionsRepo: SubmissionsRepository,
    private readonly usersRepo: UsersRepository,
    private readonly chainsRepo: ChainsRepository,
    private readonly challengesRepo: ChallengesRepository,
    private readonly verificationService: ImageAuthenticityService,
    private readonly jobQueue: JobQueueService,
    private readonly storageService: MinioStorageService
  ) {}

  /**
   * Transform database model to API response (camelCase)
   */
  private toResponse(submission: Submission): SubmissionResponse {
    return {
      id: submission.id,
      sha256Hash: submission.sha256_hash,
      walletAddress: submission.wallet_address,
      signature: submission.signature,
      challengeId: submission.challenge_id,
      chainId: submission.chain_id,
      storageKey: submission.storage_key,
      tagline: submission.tagline || undefined,
      chainPosition: submission.chain_position,
      status: submission.status,
      transactionId: submission.transaction_id || undefined,
      failureReason: submission.failure_reason || undefined,
      retryCount: submission.retry_count,
      challengeVerified: submission.challenge_verified,
      createdAt: new Date(submission.created_at),
      updatedAt: new Date(submission.updated_at),
    };
  }

  /**
   * Validate submission request
   */
  private validateSubmissionRequest(
    file: Express.Multer.File | undefined,
    chainId: string | undefined,
    walletAddress: string | undefined,
    signature: string | undefined
  ): void {
    if (!file) {
      throw Errors.badRequest('No image file provided', 'image');
    }

    if (!chainId) {
      throw Errors.badRequest('chainId is required', 'chainId');
    }

    if (!walletAddress) {
      throw Errors.badRequest('walletAddress is required', 'walletAddress');
    }

    if (!signature) {
      throw Errors.badRequest('signature is required', 'signature');
    }

    // Validate wallet address format (it's a public key in base58)
    try {
      PublicKey.fromBase58(walletAddress);
    } catch {
      throw Errors.badRequest('Invalid wallet address format', 'walletAddress');
    }

    // Validate signature format
    try {
      Signature.fromBase58(signature);
    } catch {
      throw Errors.badRequest('Invalid signature format', 'signature');
    }
  }

  /**
   * CREATE: Submit a new image for proof generation
   */
  async createSubmission(
    req: Request,
    res: Response<SubmissionResponse>,
    next: NextFunction
  ): Promise<void> {
    let storageKey: string | undefined;
    let submission: Submission | undefined;

    try {
      logger.debug('Processing submission request');

      const file = req.file;
      const { chainId, walletAddress, signature, tagline } = req.body;

      // Validate request
      this.validateSubmissionRequest(file, chainId, walletAddress, signature);

      // Read image buffer
      const imageBuffer = fs.readFileSync(file!.path);
      if (!imageBuffer || imageBuffer.length === 0) {
        throw Errors.badRequest('Image buffer is empty', 'image');
      }

      // Compute SHA256 hash of image
      const sha256Hash = this.verificationService.hashImage(imageBuffer);
      logger.debug({ sha256Hash }, 'Image hash calculated');

      // Get chain and challenge
      const chain = await this.chainsRepo.findById(chainId!);
      if (!chain) {
        throw Errors.notFound('Chain');
      }
      const challenge = await this.challengesRepo.findById(chain.challenge_id);
      if (!challenge) {
        throw Errors.notFound('Challenge');
      }

      // Verify challenge is active
      const now = new Date();
      const startTime = new Date(challenge.start_time);
      const endTime = new Date(challenge.end_time);
      if (now < startTime || now >= endTime) {
        throw Errors.badRequest('Challenge is not currently active');
      }

      // Ensure user exists
      await this.usersRepo.findOrCreate(walletAddress);

      // Verify signature
      logger.debug('Verifying signature');
      const verificationResult = this.verificationService.verifyAndPrepareImage(
        file!.path,
        signature,
        walletAddress
      );

      if (!verificationResult.isValid) {
        logger.warn({ error: verificationResult.error }, 'Invalid signature');
        throw Errors.badRequest(
          verificationResult.error || 'Signature verification failed',
          'signature'
        );
      }

      // Upload image to MinIO
      storageKey = await this.storageService.uploadImage(sha256Hash, imageBuffer);
      logger.debug({ storageKey, sha256Hash }, 'Image uploaded to MinIO');

      // Create submission (with transaction for chain/challenge updates)
      submission = await this.submissionsRepo.create({
        sha256Hash,
        walletAddress,
        signature,
        challengeId: challenge.id,
        chainId: chainId!,
        storageKey,
        tagline,
      });

      // TODO: Enable job queue for proof generation
      // const jobId = await this.jobQueue.enqueueProofGeneration({
      //   sha256Hash,
      //   signature,
      //   walletAddress,
      //   storageKey,
      //   uploadedAt: new Date(),
      //   correlationId: (req as Request & { correlationId: string }).correlationId,
      // });
      // logger.info({ jobId, submissionId: submission.id }, 'Proof generation job enqueued');

      res.status(201).json(this.toResponse(submission));
    } catch (error) {
      logger.error({ err: error }, 'Submission handler error');

      // Clean up MinIO if upload succeeded but database failed
      if (storageKey) {
        await this.storageService.deleteImage(storageKey).catch((err) => {
          logger.warn({ err }, 'Failed to delete MinIO image during cleanup');
        });
      }

      next(error);
    } finally {
      // Always clean up temp file
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }
  }

  /**
   * GET: Retrieve submission by ID
   */
  async getSubmission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const submission = await this.submissionsRepo.findById(id);
      if (!submission) {
        throw Errors.notFound('Submission');
      }

      res.json(this.toResponse(submission));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET: List submissions with optional filters
   */
  async getSubmissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { walletAddress, chainId, challengeId, status } = req.query;

      const submissions = await this.submissionsRepo.findAll({
        walletAddress: walletAddress as string | undefined,
        chainId: chainId as string | undefined,
        challengeId: challengeId as string | undefined,
        status: status as string | undefined,
      });

      res.json(submissions.map((s) => this.toResponse(s)));
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE: Remove submission (admin only, for testing)
   */
  async deleteSubmission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const deleted = await this.submissionsRepo.delete(id);
      if (!deleted) {
        throw Errors.notFound('Submission');
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
```

---

## Step 5: Unit Tests for Handler

**File**: `test/handlers/submissions.handler.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubmissionsHandler } from '../../src/handlers/submissions.handler.js';
import { PrivateKey, Signature, Field } from 'o1js';
import fs from 'fs';

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    existsSync: vi.fn(),
  },
}));

describe('SubmissionsHandler', () => {
  let handler: SubmissionsHandler;
  let mockSubmissionsRepo: any;
  let mockUsersRepo: any;
  let mockChainsRepo: any;
  let mockChallengesRepo: any;
  let mockVerificationService: any;
  let mockJobQueue: any;
  let mockStorageService: any;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  let validPublicKey: string;
  let validSignature: string;

  beforeEach(() => {
    // Setup valid crypto
    const privateKey = PrivateKey.random();
    validPublicKey = privateKey.toPublicKey().toBase58();
    validSignature = Signature.create(privateKey, [Field(123456)]).toBase58();

    // Create mocks
    mockSubmissionsRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByHash: vi.fn(),
      findAll: vi.fn(),
      hasSubmittedToChallenge: vi.fn(),
      getNextChainPosition: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    mockUsersRepo = {
      findOrCreate: vi.fn(),
    };

    mockChainsRepo = {
      findById: vi.fn(),
    };

    mockChallengesRepo = {
      findById: vi.fn(),
    };

    mockVerificationService = {
      hashImage: vi.fn(),
      verifyAndPrepareImage: vi.fn(),
    };

    mockJobQueue = {
      enqueueProofGeneration: vi.fn(),
    };

    mockStorageService = {
      uploadImage: vi.fn(),
      deleteImage: vi.fn(),
    };

    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    mockNext = vi.fn();

    handler = new SubmissionsHandler(
      mockSubmissionsRepo,
      mockUsersRepo,
      mockChainsRepo,
      mockChallengesRepo,
      mockVerificationService,
      mockJobQueue,
      mockStorageService
    );
  });

  describe('createSubmission validation', () => {
    const validChainId = '123e4567-e89b-12d3-a456-426614174000';

    beforeEach(() => {
      mockReq = {
        file: { path: '/tmp/test.jpg' },
        body: {
          chainId: validChainId,
          publicKey: validPublicKey,
          signature: validSignature,
        },
        correlationId: 'test-correlation-id',
      };

      fs.readFileSync = vi.fn().mockReturnValue(Buffer.from('test image data'));
    });

    it('should require image file', async () => {
      mockReq.file = undefined;

      await handler.createSubmission(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'No image file provided',
          field: 'image',
          statusCode: 400,
        })
      );
    });

    it('should require chainId', async () => {
      delete mockReq.body.chainId;

      await handler.createSubmission(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'chainId is required',
          field: 'chainId',
          statusCode: 400,
        })
      );
    });

    it('should require publicKey', async () => {
      delete mockReq.body.publicKey;

      await handler.createSubmission(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'publicKey is required',
          field: 'publicKey',
          statusCode: 400,
        })
      );
    });

    it('should require signature', async () => {
      delete mockReq.body.signature;

      await handler.createSubmission(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'signature is required',
          field: 'signature',
          statusCode: 400,
        })
      );
    });

    it('should validate chainId UUID format', async () => {
      mockReq.body.chainId = 'not-a-uuid';

      await handler.createSubmission(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid chainId format',
          field: 'chainId',
          statusCode: 400,
        })
      );
    });

    it('should validate publicKey format', async () => {
      mockReq.body.publicKey = 'invalid-key';

      await handler.createSubmission(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid public key format',
          field: 'publicKey',
          statusCode: 400,
        })
      );
    });

    it('should validate signature format', async () => {
      mockReq.body.signature = 'invalid-signature';

      await handler.createSubmission(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid signature format',
          field: 'signature',
          statusCode: 400,
        })
      );
    });
  });

  // Add more handler tests for success cases, error handling, etc.
});
```

---

## Step 6: Routes Layer

**File**: `src/api/routes/submissions.routes.ts`

```typescript
import { Router } from 'express';
import { SubmissionsHandler } from '../../handlers/submissions.handler.js';
import multer from 'multer';
import { config } from '../../config/index.js';

const upload = multer({
  dest: '/tmp/uploads',
  limits: {
    fileSize: config.uploadMaxSize, // Default 10MB
  },
  fileFilter: (req, file, cb) => {
    // Only accept image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

export function createSubmissionsRoutes(handler: SubmissionsHandler): Router {
  const router = Router();

  // POST /api/submissions - Create new submission
  router.post('/', upload.single('image'), handler.createSubmission.bind(handler));

  // GET /api/submissions/:id - Get submission by ID
  router.get('/:id', handler.getSubmission.bind(handler));

  // GET /api/submissions - List submissions with filters
  // Query params: walletAddress, chainId, challengeId, status
  router.get('/', handler.getSubmissions.bind(handler));

  // DELETE /api/submissions/:id - Delete submission (admin only, for testing)
  router.delete('/:id', handler.deleteSubmission.bind(handler));

  return router;
}
```

---

## Step 7: Worker Modifications

**File**: `src/workers/proofGenerationWorker.ts`

**Modifications Required**: The worker currently updates `authenticity_records` table. We need to make it work with the `submissions` table instead.

### Changes:

1. Replace `AuthenticityRepository` with `SubmissionsRepository`
2. Update status field names to match submissions schema
3. Change status values: `processing` → `proving`, add `awaiting_confirmation` state

```typescript
// In worker constructor, replace:
// private repository: AuthenticityRepository,
// with:
private submissionsRepo: SubmissionsRepository,

// In worker.start(), update status to 'proving' instead of 'processing':
await this.submissionsRepo.updateStatus(sha256Hash, {
  status: 'proving',
  // ... other fields
});

// When proof is generated, update to 'awaiting_confirmation':
await this.submissionsRepo.updateStatus(sha256Hash, {
  status: 'awaiting_confirmation',
});

// When published, update to 'verified':
await this.submissionsRepo.updateStatus(sha256Hash, {
  status: 'verified',
  transactionId: transactionId,
});

// On failure:
await this.submissionsRepo.updateStatus(sha256Hash, {
  status: isLastRetry ? 'failed' : 'pending',
  failureReason: error.message,
  retryCount: retryCount + 1,
});
```

**Note**: Since the worker operates on `sha256Hash`, we need to add a method to find submission by hash and update by hash in the repository:

```typescript
// Add to SubmissionsRepository:

async findByHash(sha256Hash: string): Promise<Submission | null> {
  const result = await this.db
    .getKnex()('submissions')
    .where('sha256_hash', sha256Hash)
    .first();
  return result || null;
}

async updateByHash(
  sha256Hash: string,
  updates: {
    status: Submission['status'];
    transactionId?: string;
    failureReason?: string;
    retryCount?: number;
  }
): Promise<void> {
  await this.db
    .getKnex()('submissions')
    .where('sha256_hash', sha256Hash)
    .update({
      status: updates.status,
      transaction_id: updates.transactionId,
      failure_reason: updates.failureReason,
      retry_count: updates.retryCount,
      updated_at: this.db.getKnex().fn.now(),
    });
}
```

---

## Step 8: Server Integration

**File**: `src/index.ts` (API server entry point)

### Add Submissions Route

```typescript
// Import
import { createSubmissionsRoutes } from './api/routes/submissions.routes.js';
import { SubmissionsHandler } from './handlers/submissions.handler.js';
import { SubmissionsRepository } from './db/repositories/submissions.repository.js';

// Initialize repository
const submissionsRepo = new SubmissionsRepository(postgresAdapter);

// Initialize handler
const submissionsHandler = new SubmissionsHandler(
  submissionsRepo,
  usersRepo,
  chainsRepo,
  challengesRepo,
  imageAuthenticityService,
  jobQueueService,
  minioStorageService
);

// Register routes
app.use('/api/submissions', createSubmissionsRoutes(submissionsHandler));
```

---

## Step 9: Worker Service Integration

**File**: `src/worker.ts` (Worker entry point)

### Update Worker Initialization

```typescript
// Replace AuthenticityRepository with SubmissionsRepository
import { SubmissionsRepository } from './db/repositories/submissions.repository.js';

const submissionsRepo = new SubmissionsRepository(postgresAdapter);

const worker = new ProofGenerationWorker(
  boss,
  submissionsRepo, // Changed from authenticityRepo
  imageAuthenticityService,
  proofGenerationService,
  proofPublishingService,
  minioStorageService
);
```

---

## Step 10: Migration Plan for Upload Endpoint

The existing `/api/upload` endpoint should be **deprecated but kept** for backward compatibility during transition.

### Option 1: Keep Both (Recommended for Gradual Migration)

1. Keep `/api/upload` functional but marked as deprecated
2. Add deprecation warning in response headers
3. Update documentation to point to `/api/submissions`
4. Monitor usage metrics
5. Remove after sufficient migration period

**Implementation**:

```typescript
// In upload.handler.ts, add deprecation header:
res.setHeader('X-Deprecated', 'Use /api/submissions instead');
res.setHeader('X-Deprecation-Date', '2025-12-31');
```

### Option 2: Redirect Upload to Submissions

Modify `upload.handler.ts` to internally use submissions:

```typescript
// In handleUpload, after validation, forward to submissions logic
// This allows backward compatibility without maintaining two codebases
```

### Option 3: Hard Cutover (Not Recommended)

Remove `/api/upload` entirely and force migration. Only use if no external clients exist.

---

## Step 11: Additional Considerations

### Database Migration Rollback

Create a rollback migration if needed:

**File**: `migrations/YYYYMMDDHHMMSS_rollback_submissions.ts`

```typescript
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('submissions');
}
```

### Environment Variables

No new environment variables are required. All existing variables work with submissions.

### Logging & Monitoring

Add structured logging for submissions:

```typescript
logger.info({ submissionId, walletAddress, chainId }, 'Submission created');
logger.info({ submissionId, status: 'verified' }, 'Submission verified');
```

### API Documentation

Update Swagger/OpenAPI documentation to include:

- `POST /api/submissions` - Create submission
- `GET /api/submissions/:id` - Get submission
- `GET /api/submissions` - List submissions with filters
- Deprecation notice on `POST /api/upload`

### Rate Limiting

Consider adding rate limiting on submissions endpoint:

```typescript
import rateLimit from 'express-rate-limit';

const submissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each user to 10 submissions per window
  keyGenerator: (req) => req.body.publicKey || req.ip,
});

router.post('/', submissionLimiter, upload.single('image'), handler.createSubmission.bind(handler));
```

### Error Recovery

Implement comprehensive cleanup on failures:

- Delete temp files
- Delete MinIO objects
- Rollback database transactions
- Cancel enqueued jobs (if possible)

### Testing Checklist

- [ ] All integration tests pass
- [ ] All unit tests pass
- [ ] Upload endpoint still works (backward compatibility)
- [ ] Worker processes submissions correctly
- [ ] Chain length updates correctly
- [ ] Challenge participant count updates correctly
- [ ] Duplicate detection works
- [ ] Signature verification works
- [ ] Job queue integration works
- [ ] MinIO storage integration works
- [ ] Error handling and cleanup work
- [ ] Logging produces correct output
- [ ] API response shapes are correct (camelCase)
- [ ] Database constraints are enforced
- [ ] Performance is acceptable under load

---

## Implementation Order Summary

1. **Integration Tests** (Step 1) - Write comprehensive tests first
2. **Repository** (Step 2) - Implement data access layer
3. **Repository Tests** (Step 3) - Unit test repository
4. **Handler** (Step 4) - Implement business logic
5. **Handler Tests** (Step 5) - Unit test handler
6. **Routes** (Step 6) - Wire up Express routes
7. **Worker** (Step 7) - Modify worker for submissions
8. **Server Integration** (Step 8) - Add to main server
9. **Worker Integration** (Step 9) - Update worker entry point
10. **Migration Plan** (Step 10) - Handle upload endpoint deprecation
11. **Testing & Validation** - Run all tests, verify functionality

---

## Timeline Estimate

- **Integration Tests**: 4-6 hours
- **Repository + Tests**: 3-4 hours
- **Handler + Tests**: 4-6 hours
- **Routes**: 1 hour
- **Worker Modifications**: 2-3 hours
- **Integration & Testing**: 3-4 hours
- **Documentation**: 2 hours

**Total**: ~20-26 hours (2.5-3 days for one developer)

---

## Success Criteria

✅ All integration tests pass
✅ All unit tests pass
✅ Zero breaking changes to existing upload endpoint
✅ Worker successfully processes submissions
✅ Chain and challenge metrics update correctly
✅ Database constraints enforce business rules
✅ API responses match expected shape
✅ Comprehensive error handling and cleanup
✅ Logging and monitoring in place
✅ Documentation updated

---

## Notes for Developer Taking Over

- **Read CLAUDE.md first** - Contains all architectural patterns and conventions
- **Follow existing patterns** - Users, Challenges, Chains resources are good references
- **Test-driven approach** - Write tests before implementation
- **Use dependency injection** - All handlers receive dependencies via constructor
- **camelCase for API, snake_case for DB** - Consistent transformation pattern
- **Error handling** - Use `Errors` utility for consistent error responses
- **Cleanup on failure** - Always clean up temp files, MinIO objects, DB records
- **Transactions** - Use DB transactions for atomic operations
- **Context propagation** - Ensure correlation IDs flow through
- **Logging** - Use structured logging with Pino
- **File extensions** - Always use `.js` for TypeScript imports (ESM requirement)

---

## Questions & Clarifications

If you need clarification on any part of this plan:

1. Check existing implementations (challenges, users, chains) for patterns
2. Review CLAUDE.md for architectural decisions
3. Check test files for expected behavior
4. Review database schema in migrations

Good luck with the implementation! 🚀
