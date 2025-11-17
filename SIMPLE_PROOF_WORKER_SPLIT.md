# Proof Worker Split: Simplified Solution

## Problem

**Current**: When blockchain publishing fails, the entire job retries including expensive proof generation (~30-60s).

**Goal**: Split into two jobs so publishing failures retry independently without regenerating proofs.

 

## Simplified Solution

### Compilation Requirements (Only 2 Needed)

| Component | When | Why | Where |
|-----------|------|-----|-------|
| `AuthenticityProgram` | Before proof deserialization | `fromJSON()` requires it | Publishing worker |
| `AuthenticityZkApp` | Before transaction | `txn.prove()` requires it | Publishing service (already exists) |
 
### Database Changes (Minimal)

```sql
-- Add one column to submissions table
ALTER TABLE submissions ADD COLUMN proof_json JSONB;

-- Update status values (replace 'processing' with specific statuses)
ALTER TABLE submissions DROP CONSTRAINT submissions_status_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_status_check
  CHECK (status IN ('awaiting_review', 'rejected', 'proof_generation', 'proof_publishing', 'complete'));
```

### Status Flow

```
proof_generation → proof_publishing → complete
       ↓                  ↓
    rejected           rejected
```

**Status meanings**:
- `proof_generation` - Worker is generating the ZK proof (~30-60s)
- `proof_publishing` - Worker is publishing proof to blockchain (~5-10s)
- `complete` - Transaction submitted successfully
- `rejected` - Failed after all retries

### Code Changes

#### 1. ProofGenerationWorker (Modify)

**Current behavior** (lines 84-144):
```typescript
// Update status to processing
await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
  status: 'processing',
  processing_started_at: processingStartedAt,
  retry_count: retryCount,
});

// Generate proof
const { proof } = await this.proofGenerationService.generateProof(...);

// Publish immediately
const transactionId = await this.proofPublishingService.publishProof(...);

// Update status to complete
await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
  status: 'complete',
  transaction_id: transactionId,
  verified_at: new Date().toISOString(),
});
```

**New behavior**:
```typescript
// Update status to proof_generation
await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
  status: 'proof_generation',
  processing_started_at: processingStartedAt,
  retry_count: retryCount,
});

// Generate proof
const { proof } = await this.proofGenerationService.generateProof(...);

// Serialize and store proof
const proofJson = proof.toJSON();
await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
  proof_json: proofJson,
  status: 'proof_publishing',  // Ready for publishing
});

// Enqueue publishing job
await this.jobQueue.enqueueProofPublishing({
  sha256Hash,
  zkAppAddress,
  correlationId: job.data.correlationId,
});

logger.info('Proof generated, publishing job enqueued');
```

**Changes**:
- ✅ Change initial status from `processing` to `proof_generation`
- ✅ Stop after proof generation
- ✅ Serialize proof: `proof.toJSON()`
- ✅ Store in database with status `proof_publishing`
- ✅ Enqueue publishing job
- ❌ Remove direct publishing call

#### 2. ProofPublishingWorker (New)

**File**: `src/workers/proofPublishingWorker.ts`

```typescript
import PgBoss from 'pg-boss';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { ProofPublishingService } from '../services/zk/proofPublishing.service.js';
import { ProofPublishingJobData } from '../services/queue/jobQueue.service.js';
import { AuthenticityProgram, AuthenticityProof } from 'authenticity-zkapp';
import { Cache } from 'o1js';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';
import { config } from '../config/index.js';

export class ProofPublishingWorker {
  constructor(
    private boss: PgBoss,
    private submissionsRepository: SubmissionsRepository,
    private proofPublishingService: ProofPublishingService
  ) {}

  async start(): Promise<void> {
    await this.boss.work<ProofPublishingJobData>(
      'proof-publishing',
      { includeMetadata: true },
      async (jobs: PgBoss.JobWithMetadata<ProofPublishingJobData>[]) => {
        for (const job of jobs) {
          const retryCount = job.retryCount || 0;

          await withContext(
            {
              jobId: job.id,
              sha256Hash: job.data.sha256Hash,
              correlationId: job.data.correlationId,
              attempt: retryCount,
            },
            async () => {
              const jobTracker = new PerformanceTracker('job.proofPublishing', {
                sha256Hash: job.data.sha256Hash,
              });
              logger.info('Starting proof publishing job');

              const { sha256Hash, zkAppAddress } = job.data;

              try {
                // Fetch submission with proof
                const submission = await this.submissionsRepository.findBySha256Hash(sha256Hash);

                if (!submission?.proof_json) {
                  throw new Error('Proof JSON not found in database');
                }

                // Compile AuthenticityProgram (required for proof deserialization)
                logger.info('Compiling AuthenticityProgram for proof deserialization');
                const cache = Cache.FileSystem(config.circuitCachePath);
                const compileTracker = new PerformanceTracker('publish.compileProgram');
                await AuthenticityProgram.compile({ cache });
                compileTracker.end('success');

                // Deserialize proof
                logger.info('Deserializing proof from JSON');
                const deserializeTracker = new PerformanceTracker('publish.deserializeProof');
                const proof = await AuthenticityProof.fromJSON(submission.proof_json);
                deserializeTracker.end('success');

                // Publish to blockchain (service compiles AuthenticityZkApp)
                logger.info('Publishing proof to blockchain');
                const publishTracker = new PerformanceTracker('publish.transaction');
                const transactionId = await this.proofPublishingService.publishProof(
                  sha256Hash,
                  proof,
                  zkAppAddress
                );
                publishTracker.end('success', { transactionId });

                // Update status and clear proof_json
                await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
                  status: 'complete',
                  verified_at: new Date().toISOString(),
                  proof_json: null,  // Clear to save database space
                });

                jobTracker.end('success', { transactionId });
                logger.info({ transactionId }, 'Proof publishing completed successfully');
              } catch (error) {
                const isLastRetry = retryCount >= config.workerRetryLimit - 1;

                logger.error(
                  {
                    err: error,
                    isLastRetry,
                  },
                  'Proof publishing failed'
                );

                // Update failure status
                if (isLastRetry) {
                  const failureReason =
                    error instanceof Error ? error.message : String(error);

                  await this.submissionsRepository.updateBySha256Hash(sha256Hash, {
                    status: 'rejected',
                    failed_at: new Date().toISOString(),
                    failure_reason: failureReason,
                    proof_json: null,  // Clear proof on final failure
                  });
                }

                // Re-throw to trigger pg-boss retry
                throw error;
              }
            }
          );
        }
      }
    );

    logger.info('Proof publishing worker started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping proof publishing worker...');
  }
}
```

**Key features**:
- ✅ Compiles `AuthenticityProgram` before deserialization
- ✅ Uses cached compilation (fast)
- ✅ Deserializes proof from JSON
- ✅ Publishing service handles `AuthenticityZkApp` compilation (no change needed)
- ✅ Clears `proof_json` on success (saves database space)
- ✅ Clears `proof_json` on final failure (no orphaned data)
- ✅ Independent retry logic

#### 3. JobQueueService (Add method)

**File**: `src/services/queue/jobQueue.service.ts`

```typescript
// Add interface
export interface ProofPublishingJobData {
  sha256Hash: string;
  zkAppAddress: string;
  correlationId?: string;
}

// Add method to JobQueueService class
async enqueueProofPublishing(data: ProofPublishingJobData): Promise<string> {
  const jobId = await this.boss.send('proof-publishing', data, {
    singletonKey: data.sha256Hash,
    retryLimit: config.workerRetryLimit,
    retryDelay: 60,  // Faster retry - no proof generation needed
    retryBackoff: true,
    expireInHours: 24,
  });

  if (!jobId) {
    throw new Error('Failed to enqueue proof publishing job');
  }

  logger.info(
    { jobId, sha256Hash: data.sha256Hash },
    'Proof publishing job enqueued'
  );
  return jobId;
}
```

#### 4. Database Types (Update)

**File**: `src/db/types/touchgrass.types.ts`

```typescript
export interface Submission {
  // ... existing fields ...
  status: 'awaiting_review' | 'rejected' | 'proof_generation' | 'proof_publishing' | 'complete';  // Replace 'processing' with specific statuses
  proof_json?: object | null;  // Add new field
  // ... rest of fields ...
}
```

#### 5. Entry Point (New)

**File**: `src/startProofPublishingWorker.ts`

```typescript
import { config } from './config/index.js';
import { DatabaseConnection } from './db/database.js';
import { SubmissionsRepository } from './db/repositories/submissions.repository.js';
import { ProofPublishingService } from './services/zk/proofPublishing.service.js';
import { MinaNodeService } from './services/blockchain/minaNode.service.js';
import { ProofPublishingWorker } from './workers/proofPublishingWorker.js';
import PgBoss from 'pg-boss';
import { logger } from './utils/logger.js';

async function startWorker() {
  logger.info('Starting Proof Publishing Worker...');

  let boss: PgBoss | null = null;
  let dbConnection: DatabaseConnection | null = null;

  try {
    // Initialize database
    logger.info('Initializing database connection...');
    dbConnection = new DatabaseConnection({
      connectionString: config.databaseUrl,
    });
    await dbConnection.initialize();
    const submissionsRepository = new SubmissionsRepository(dbConnection.getAdapter());

    // Initialize pg-boss
    logger.info('Initializing pg-boss...');
    boss = new PgBoss(config.databaseUrl);
    await boss.start();

    // Initialize services
    logger.info('Initializing services...');
    const minaNodeService = new MinaNodeService(config.minaNodeEndpoint);
    const proofPublishingService = new ProofPublishingService(
      config.feePayerPrivateKey,
      config.minaNetwork,
      submissionsRepository,
      minaNodeService
    );

    // Start worker
    const worker = new ProofPublishingWorker(
      boss,
      submissionsRepository,
      proofPublishingService
    );

    await worker.start();
    logger.info('Proof publishing worker started successfully');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      if (worker) {
        await worker.stop();
      }

      if (boss) {
        await boss.stop();
        logger.info('Job queue stopped');
      }

      if (dbConnection) {
        await dbConnection.close();
        logger.info('Database connection closed');
      }

      logger.info('Worker shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start proof publishing worker');

    if (boss) {
      await boss.stop();
    }
    if (dbConnection) {
      await dbConnection.close();
    }

    process.exit(1);
  }
}

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught Exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled Rejection');
  process.exit(1);
});

startWorker().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start proof publishing worker');
  process.exit(1);
});
```

#### 6. Package.json Scripts

```json
{
  "scripts": {
    "dev:proof-publishing": "tsx src/startProofPublishingWorker.ts",
    "start:proof-publishing": "node dist/startProofPublishingWorker.js"
  }
}
```

**Note**: No pre-compilation script needed - worker compiles at runtime using cache.

---

## No Changes Needed

These components work as-is:

- ✅ `ProofGenerationService` - Already compiles `AuthenticityProgram` during proof generation
- ✅ `ProofPublishingService` - Already compiles `AuthenticityZkApp` during publishing
- ✅ `DatabaseConnection` - Handles all database operations
- ✅ Error handling - Retry logic built into pg-boss

---

## Migration

**File**: `migrations/YYYYMMDDHHMMSS_add_proof_json_and_split_statuses.ts`

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add proof_json column
  await knex.schema.alterTable('submissions', (table) => {
    table.jsonb('proof_json').nullable();
  });

  // Update existing 'processing' status to 'proof_generation' for active jobs
  await knex('submissions')
    .where('status', 'processing')
    .update({ status: 'proof_generation' });

  // Update status check constraint with new granular statuses
  await knex.raw(`
    ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_status_check;
    ALTER TABLE submissions ADD CONSTRAINT submissions_status_check
      CHECK (status IN ('awaiting_review', 'rejected', 'proof_generation', 'proof_publishing', 'complete'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Consolidate statuses back to 'processing'
  await knex('submissions')
    .whereIn('status', ['proof_generation', 'proof_publishing'])
    .update({ status: 'processing' });

  // Remove proof_json column
  await knex.schema.alterTable('submissions', (table) => {
    table.dropColumn('proof_json');
  });

  // Restore original status check constraint
  await knex.raw(`
    ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_status_check;
    ALTER TABLE submissions ADD CONSTRAINT submissions_status_check
      CHECK (status IN ('awaiting_review', 'rejected', 'processing', 'complete'));
  `);
}
```

---

## Deployment

### Railway Services

```yaml
# Add new service
proof-publishing-worker:
  memory: 512MB       # Lightweight (no proof generation)
  replicas: 1         # Start with 1
  build:
    command: npm run build
  start:
    command: npm run start:proof-publishing
  healthcheck:
    timeout: 180s
    retries: 3
```

### Deployment Steps

1. Deploy migration (adds `proof_json` column and `publishing` status)
2. Deploy updated API (includes new types)
3. Deploy publishing worker (starts listening, queue is empty)
4. Deploy updated proof generation worker (starts enqueueing publishing jobs)
5. Monitor logs

### Rollback

```bash
# Stop new worker
railway service stop proof-publishing-worker

# Rollback proof generation worker
railway rollback --service proof-generation-worker

# Rollback migration
npx knex migrate:rollback
```

---

## Benefits

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Publishing retry time | 30-60s | < 1s | **30-60x faster** |
| Wasted compute on retry | Full proof regen | None | **100% saved** |
| Worker RAM (publishing) | 2GB | 512MB | **4x reduction** |
| Observability | Single status | Separate statuses | **Better debugging** |

---

## Testing

### Unit Test

```typescript
test('should serialize and deserialize proof', async () => {
  const { proof } = await generateTestProof();
  const proofJson = proof.toJSON();

  // Compile before deserializing
  await AuthenticityProgram.compile({ cache: Cache.FileSystem('./cache') });
  const deserialized = await AuthenticityProof.fromJSON(proofJson);

  expect(deserialized).toBeDefined();
  expect(deserialized.publicInput).toEqual(proof.publicInput);
});
```

### Integration Test

```typescript
test('should split proof generation and publishing', async () => {
  const submission = await uploadTestSubmission();

  // Wait for proof generation
  await waitForStatus(submission.sha256_hash, 'publishing');
  const withProof = await getSubmission(submission.sha256_hash);
  expect(withProof.proof_json).toBeDefined();

  // Wait for publishing
  await waitForStatus(submission.sha256_hash, 'complete');
  const completed = await getSubmission(submission.sha256_hash);
  expect(completed.proof_json).toBeNull();  // Cleaned up
  expect(completed.transaction_id).toBeDefined();
});
```

### Manual Test

```bash
# Terminal 1: Start proof generation worker
npm run dev:worker

# Terminal 2: Start proof publishing worker
npm run dev:proof-publishing

# Terminal 3: Submit test image
IMAGE_PATH=./test.png API_URL=http://localhost:3000 tsx test-upload.mts

# Watch logs - should see:
# Worker 1: "Proof generated, publishing job enqueued"
# Worker 2: "Compiling AuthenticityProgram for proof deserialization"
# Worker 2: "Proof publishing completed successfully"
```

---

## Summary

**Changed Files**: 7
- 1 migration (adds `proof_json`, replaces `processing` with `proof_generation`/`proof_publishing`)
- 2 workers (1 modified, 1 new)
- 1 service (add method)
- 1 types file (update statuses)
- 1 entry point (new)
- 1 package.json (add scripts)

**Lines of Code**: ~200 new, ~20 modified

**Complexity**: Low - follows existing patterns, minimal new concepts

**Risk**: Low - safe rollback, migration handles status updates gracefully

**Benefits**:
- 30-60x faster publishing retries
- Better resource usage (512MB vs 2GB for publishing worker)
- **Improved observability** - Clear status differentiation (`proof_generation` vs `proof_publishing`)
- Better debugging and monitoring

---

## Key Insights

1. **BatchReducer not needed** - Removed from zkApp, don't compile it
2. **Only 2 compilations required** - AuthenticityProgram (for deserialization) + AuthenticityZkApp (for transaction)
3. **Minimal schema changes** - Just `proof_json` column and granular statuses
4. **No service changes** - Existing services work as-is
5. **Simple pattern** - Store proof → Load proof → Publish
6. **Clear status flow** - `proof_generation` → `proof_publishing` → `complete` (much clearer than generic `processing`)
