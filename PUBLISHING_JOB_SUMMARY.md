# Publishing Job Branch Summary

## Overview

The `publishing-job` branch successfully splits the monolithic proof worker into **two independent workers** for better error handling and faster failure recovery.

## Key Architecture Changes

**Before:** Single long-running job (proof generation → blockchain publishing)
- If publishing failed, entire job retried including expensive proof generation
- Failure at any point meant losing all progress

**After:** Two separate jobs with independent retry logic
1. **Proof Generation Worker** (generates ZK proof)
2. **Proof Publishing Worker** (publishes to blockchain)

## Database Schema Changes

**Migration:** `migrations/20251115202601_split_proof_generation_and_publishing.ts`

New columns in `submissions` table:
- `proof_json` (JSONB) - Stores serialized proof between generation and publishing
- `proof_generated_at` (timestamp) - When proof generation completed
- `publishing_started_at` (timestamp) - When publishing started

New status values:
- `proof_generation` - Generating ZK proof
- `proof_generated` - Proof ready for publishing
- `proof_publishing` - Publishing to blockchain
- `complete` - Successfully published

## New Worker: ProofPublishingWorker

**Files:**
- `src/workers/proofPublishingWorker.ts`
- `src/startProofPublishingWorker.ts`

**Characteristics:**
- Lightweight worker (512MB RAM vs 2GB for proof generation)
- Retrieves proof from database (no regeneration needed)
- Publishes to Mina blockchain
- Clears `proof_json` after successful publishing (saves DB space)
- Independent retry logic (3 attempts with exponential backoff)

## Modified Components

### ProofGenerationWorker
**File:** `src/workers/proofGenerationWorker.ts:141-150`

Changes:
- Now stops after generating proof
- Stores proof as JSON in database
- Enqueues proof-publishing job instead of publishing directly

### JobQueueService
**File:** `src/services/queue/jobQueue.service.ts:148-163`

Changes:
- New `enqueueProofPublishing()` method
- New queue: `proof-publishing` with singleton key
- Retry configuration: 3 attempts, 60s delay, exponential backoff

### ProofPublishingService
**File:** `src/services/zk/proofPublishing.service.ts`

Changes:
- Accepts pre-generated proof (no generation logic)
- Compiles zkApp circuits independently
- Handles blockchain transaction submission

### Package.json

New scripts:
```json
"dev:proof-publishing": "tsx src/startProofPublishingWorker.ts"
"start:proof-publishing": "tsx scripts/compile-zkapp.ts && node dist/startProofPublishingWorker.js"
```

## Workflow

### Previous Workflow
1. Submission uploaded
2. Proof generation job enqueued
3. Worker: Download image → Verify → Generate proof → Publish → Complete
   - **Problem:** If publishing fails, entire process retries (including expensive proof generation)

### New Workflow
1. Submission uploaded
2. Proof generation job enqueued
3. Proof Generation Worker:
   - Download image from MinIO
   - Verify ECDSA signature
   - Generate ZK proof (~30-60 seconds)
   - Store proof in `proof_json` column
   - Update status to `proof_generated`
   - Enqueue proof publishing job
4. Proof Publishing Worker:
   - Retrieve proof from database
   - Compile zkApp circuits
   - Publish to blockchain
   - Update status to `complete`
   - Clear `proof_json` to save space

## Benefits

✅ **Faster error recovery** - Publishing failures retry in ~60s instead of regenerating 30+ second proofs

✅ **Better resource isolation** - Publishing worker needs less RAM (512MB vs 2GB)

✅ **Independent scaling** - Scale proof generation and publishing separately

✅ **Cost efficiency** - Don't waste compute regenerating proofs on publishing failures

✅ **Better observability** - Separate status tracking for each stage (`proof_generated` vs `proof_publishing`)

✅ **Improved debugging** - Easier to identify whether failures are in proof generation or blockchain publishing

## Deployment Impact

### Infrastructure Changes
- **New Railway Service Required:** Proof Publishing Worker
  - Resource requirements: 512MB RAM (lightweight)
  - Entry point: `npm run start:proof-publishing`
  - Separate scaling from proof generation worker

### Database Migration
- Migration `20251115202601_split_proof_generation_and_publishing.ts` will run automatically on deployment
- Adds new columns to `submissions` table
- Updates status check constraint

### Environment Variables
No new environment variables required - uses existing configuration.
 

## Rollback Plan

If issues arise, rollback via:
```bash
npx knex migrate:rollback
```

This will:
- Remove new columns (`proof_json`, `proof_generated_at`, `publishing_started_at`)
- Restore original status check constraint
- Revert to previous workflow

## Files Changed

### New Files
- `migrations/20251115202601_split_proof_generation_and_publishing.ts`
- `src/workers/proofPublishingWorker.ts`
- `src/startProofPublishingWorker.ts`

### Modified Files
- `CLAUDE.md` - Updated documentation
- `package.json` - Added new scripts
- `src/db/types/touchgrass.types.ts` - Added new fields
- `src/handlers/submissions.handler.ts` - Updated to handle new statuses
- `src/services/queue/jobQueue.service.ts` - Added proof publishing queue
- `src/services/zk/proofGeneration.service.ts` - Removed publishing logic
- `src/services/zk/proofPublishing.service.ts` - Accepts pre-generated proofs
- `src/startProofWorker.ts` - Updated worker initialization
- `src/workers/proofGenerationWorker.ts` - Enqueues publishing job instead of publishing directly
