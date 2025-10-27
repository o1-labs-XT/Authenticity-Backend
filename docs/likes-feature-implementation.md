# Likes Feature Implementation Plan

## Architecture Overview

### Database Schema
- `likes` table with compound unique constraint (submission_id, wallet_address)
- Cascade deletes when submissions or users are deleted
- Indexes for performance on common queries

### API Endpoints
- `POST /api/submissions/:submissionId/likes` - Create a like (body: `{ walletAddress }`)
- `DELETE /api/submissions/:submissionId/likes/:walletAddress` - Delete a like
- `GET /api/submissions/:submissionId/likes` - Get all likes for a submission
- `GET /api/submissions/:submissionId/likes/count` - Get like count (lightweight)

### Restriction
- Users can only like submissions if they have at least one admin-approved submission themselves
- Handler will include a validation method `canUserLike(walletAddress: string)` that checks if user has approved submissions
- User must exist in the database (no auto-creation)

---

## Implementation Steps

### 1. Integration Tests (Test-Driven Development)
**File:** `test/integration/likes.integration.test.ts`

**Test cases:**
- Create like with valid data (user has approved submission)
- Reject duplicate likes (same user, same submission)
- Delete like successfully
- Get all likes for a submission
- Get like count for a submission
- Reject like from non-existent user
- Reject like from user without approved submission
- Reject like for non-existent submission
- Ensure likes cascade delete when submission is deleted
- Ensure likes cascade delete when user is deleted

---

### 2. Database Migration
**File:** `migrations/YYYYMMDDHHMMSS_create_likes_table.ts`

**Schema:**
```typescript
CREATE TABLE likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  wallet_address VARCHAR(255) NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(submission_id, wallet_address)
)
```

**Indexes:**
- `submission_id` (for listing likes by submission)
- `wallet_address` (for listing likes by user)
- `created_at` (for ordering)

---

### 3. Database Types
**File:** `src/db/types/touchgrass.types.ts`

**Add interface:**
```typescript
export interface Like {
  id: string;
  submission_id: string;
  wallet_address: string;
  created_at: string;
  updated_at: string;
}
```

---

### 4. Likes Repository
**File:** `src/db/repositories/likes.repository.ts`

**Methods:**
- `create(submissionId: string, walletAddress: string): Promise<Like>`
- `findById(id: string): Promise<Like | null>`
- `findBySubmissionAndUser(submissionId: string, walletAddress: string): Promise<Like | null>`
- `findBySubmission(submissionId: string): Promise<Like[]>`
- `countBySubmission(submissionId: string): Promise<number>`
- `delete(submissionId: string, walletAddress: string): Promise<boolean>`
- `existsBySubmissionAndUser(submissionId: string, walletAddress: string): Promise<boolean>`

**Error handling:**
- Unique constraint violation → `Errors.conflict('You have already liked this submission')`
- Foreign key violation → `Errors.notFound('Submission or User not found')`

---

### 5. Likes Handler
**File:** `src/handlers/likes.handler.ts`

**Constructor dependencies:**
- `LikesRepository`
- `UsersRepository`
- `SubmissionsRepository`

**Methods:**
- `createLike(req, res, next)` - POST /api/submissions/:submissionId/likes
- `deleteLike(req, res, next)` - DELETE /api/submissions/:submissionId/likes/:walletAddress
- `getLikes(req, res, next)` - GET /api/submissions/:submissionId/likes
- `getLikeCount(req, res, next)` - GET /api/submissions/:submissionId/likes/count

**Private helper:**
- `canUserLike(walletAddress: string): Promise<boolean>` - Checks if user has at least one admin-approved submission

**Response types:**
```typescript
export interface LikeResponse {
  id: string;
  submissionId: string;
  walletAddress: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LikeCountResponse {
  submissionId: string;
  count: number;
}
```

**Validation:**
- Submission exists
- User exists (reject if not found, no auto-creation)
- Wallet address format is valid (use o1js PublicKey validation)
- User has at least one admin-approved submission (call `canUserLike()`)

---

### 6. Likes Routes
**File:** `src/api/routes/likes.routes.ts`

**Pattern:** Nested under submissions routes

```typescript
export function createLikesRoutes(handler: LikesHandler): Router {
  const router = Router({ mergeParams: true }); // Important for :submissionId

  router.post('/', handler.createLike.bind(handler));
  router.delete('/:walletAddress', handler.deleteLike.bind(handler));
  router.get('/count', handler.getLikeCount.bind(handler)); // Must be before /:walletAddress
  router.get('/', handler.getLikes.bind(handler));

  return router;
}
```

**Mount in main routes file as:** `/api/submissions/:submissionId/likes`

---

### 7. Wire Up Dependencies
**File:** `src/index.ts`

- Instantiate `LikesRepository`
- Instantiate `LikesHandler` with dependencies
- Create `likesRoutes` and mount at `/api/submissions/:submissionId/likes`

---

### 8. Update Submissions Response (Optional Enhancement)
**File:** `src/handlers/submissions.handler.ts`

**Add optional like count to submission response:**
```typescript
export interface SubmissionResponse {
  // ... existing fields
  likeCount?: number; // Optional, only included when explicitly requested
}
```

---

## Testing Strategy

### Integration Tests Coverage
1. Happy path: Create, read, delete likes (with approved submissions)
2. Validation: Invalid submission ID, invalid wallet address, non-existent user, user without approved submission
3. Uniqueness: Prevent duplicate likes
4. Cascade deletes: Verify likes are deleted with submissions/users
5. Edge cases: Empty results, non-existent resources

### Test Helpers
**File:** `test/integration/utils/test-helpers.ts`

**Add:**
```typescript
export const getLikeCount = async (submissionId: string): Promise<number> {
  const res = await request(API_URL).get(`/api/submissions/${submissionId}/likes/count`);
  return res.body.count;
}
```

---

## Approval Restriction Implementation

Users can only like submissions if they have at least one admin-approved submission.

### `LikesHandler.canUserLike()` implementation:
```typescript
private async canUserLike(walletAddress: string): Promise<boolean> {
  const approvedSubmissions = await this.submissionsRepo.findAll({
    walletAddress,
  });

  // User must have at least one submission where challengeVerified is true
  return approvedSubmissions.some(s => s.challenge_verified === true);
}
```

### Validation in `createLike()`:
```typescript
// Check if user exists
const user = await this.usersRepo.findByWalletAddress(walletAddress);
if (!user) {
  throw Errors.notFound('User not found', 'walletAddress');
}

// Check if user has approved submission
const canLike = await this.canUserLike(walletAddress);
if (!canLike) {
  throw Errors.forbidden(
    'You must have an admin-approved submission before you can like other submissions',
    'walletAddress'
  );
}
```

---

## Key Design Decisions

1. **One like per user per submission:** Enforced by unique constraint in database
2. **No auto-create users:** Users must exist in database before liking (created during submission)
3. **Approval requirement:** Users must have at least one admin-approved submission to like others
4. **Nested routes:** `/api/submissions/:submissionId/likes` follows REST conventions
5. **Separate count endpoint:** Optimized for performance, avoids loading full like objects
6. **Cascade deletes:** Maintain referential integrity automatically
7. **No authentication required:** Follows existing pattern of wallet-address-based identity

---

## Files to Create/Modify

### New Files (7)
1. `migrations/YYYYMMDDHHMMSS_create_likes_table.ts`
2. `src/db/repositories/likes.repository.ts`
3. `src/handlers/likes.handler.ts`
4. `src/api/routes/likes.routes.ts`
5. `test/integration/likes.integration.test.ts`

### Modified Files (2)
6. `src/db/types/touchgrass.types.ts` - Add Like interface
7. `src/index.ts` - Wire up dependencies

---

## Implementation Order

1. **Integration tests first** (TDD approach)
2. Database migration
3. Database types
4. Likes repository
5. Likes handler
6. Likes routes
7. Wire up dependencies in index.ts
8. Test helper utilities
9. Run integration tests and iterate until passing
