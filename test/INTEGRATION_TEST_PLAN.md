# Integration Testing Plan for Workers and Services

## Overview

This document outlines the comprehensive plan for integration testing the proof generation and blockchain monitoring workflows. The focus is on testing **complete workflows** rather than isolated services, since services don't run in isolation - they run as part of complete flows triggered by API requests or worker jobs.

### Architectural Reality

**ProofGeneration Workflow:**
```
POST /api/submissions
  → SubmissionsRepository.create() (DB)
  → StorageService.uploadImage() (MinIO)
  → JobQueueService.enqueueProofGeneration() (pg-boss)
  → ProofGenerationWorker picks up job
    → StorageService.downloadImage()
    → ImageAuthenticityService.verifyAndPrepareImage()
    → ProofGenerationService.generateProof() [SLOW - mock this]
    → ProofPublishingService.publishProof() [SLOW - mock this]
    → SubmissionsRepository.updateBySha256Hash() (status='complete')
    → StorageService cleanup
```

**BlockchainMonitoring Workflow:**
```
Timer triggers
  → JobQueueService.enqueueBlockchainMonitoring()
  → BlockchainMonitorWorker picks up job
    → SubmissionsRepository.getRecentTransactionsForMonitoring()
    → MinaNodeService.getCurrentBlockHeight() [MOCK - network call]
    → ArchiveNodeService.fetchActionsWithBlockInfo() [MOCK - network call]
    → BlockchainMonitoringService.aggregateTransactionStatus()
    → BlockchainMonitoringService.logTransactionStatus()
```

## Key Testing Principles

1. **Test workflows, not services in isolation**
   - Services are tested implicitly through workflows
   - Workflow tests verify the orchestration and integration
   - No redundant isolated service tests

2. **Mock at service boundaries for expensive operations**
   - Mock: ProofGenerationService, ProofPublishingService, ArchiveNodeService, MinaNodeService
   - Real: Database, pg-boss, MinIO, pure logic services

3. **Use real workers, not synthetic test flows**
   - Create actual ProofGenerationWorker instance
   - Call worker.start() to register job handlers
   - Enqueue jobs using real JobQueueService

4. **Assert on observable outcomes**
   - Database state changes
   - MinIO file operations
   - Job queue state
   - Log output

5. **Keep repository integration tests**
   - Repositories have complex SQL queries worth testing separately

6. **Follow existing patterns**
   - Use supertest for API testing
   - Use beforeAll/afterEach/afterAll for lifecycle
   - Use test helpers from test/integration/utils/test-helpers.ts

## File Structure

```
test/
├── unit/                          # Pure logic tests
│   ├── handlers/                  # Mock all services (existing)
│   └── services/
│       ├── monitoring.test.ts     # Pure aggregation logic (no external deps)
│       └── image/                 # Crypto/hash logic (existing)
├── integration/
│   ├── workflows/                 # NEW - Primary focus
│   │   ├── proof-generation-real.integration.test.ts (RUN_SLOW_TESTS=true)
│   │   ├── blockchain-monitoring-real.integration.test.ts (RUN_SLOW_TESTS=true)
│   │   ├── proof-generation-workflow.integration.test.ts (mocked)
│   │   ├── blockchain-monitoring-workflow.integration.test.ts (mocked)
│   │   └── error-recovery-workflow.integration.test.ts (mocked)
│   ├── repositories/              # Keep existing
│   │   └── *.repository.integration.test.ts
│   └── api/                       # Keep existing API tests
│       ├── submissions.integration.test.ts
│       ├── challenges.integration.test.ts
│       ├── chains.integration.test.ts
│       └── users.integration.test.ts
└── utils/
    └── worker-test-helpers.ts     # NEW - Worker test utilities
```

## Test Execution Strategy

All tests are **required** for production confidence. Tests are organized into two execution modes:

### Mode 1: Real End-to-End Tests
- **Command**: `RUN_SLOW_TESTS=true npm run test:integration`
- **Runtime**: 5-10 minutes
- **Purpose**: Validate actual ZK proofs and blockchain integration
- **When**: Before releases, nightly CI/CD, after o1js/zkApp updates
- Uses real ProofGenerationService, ProofPublishingService, blockchain

### Mode 2: Fast Workflow Tests
- **Command**: `npm run test:integration` (default)
- **Runtime**: < 2 minutes
- **Purpose**: Fast feedback on orchestration and error handling
- **When**: Every commit, every PR
- Mocks expensive operations (ZK proofs, blockchain)

Both test modes are essential - real tests validate actual behavior, fast tests enable rapid development.

---

## Detailed Test Specifications

### Phase 1: Real End-to-End Tests (Implementation Priority)

These tests run the complete system with **no mocking** - real ZK proof generation, real blockchain publishing to testnet. They validate that the entire workflow actually works in production-like conditions.

---

#### Test 1.1: Real ProofGeneration End-to-End

**File:** `test/integration/workflows/proof-generation-real.integration.test.ts`

**Purpose:** Validate complete proof generation workflow with real ZK proofs and blockchain publishing

**Execution:** Only runs when `RUN_SLOW_TESTS=true`

**Dependencies:**
- Real: Everything (no mocking)
- Requires: Testnet access, funded fee payer account, deployed zkApp

**Test Cases:**

**1. Happy Path - Full Real Workflow**
- Create submission with valid image and ECDSA signature
- Enqueue proof generation job in pg-boss
- Worker picks up job
- Downloads image from MinIO
- Verifies ECDSA signature using real o1js
- Generates real ZK proof (30+ seconds)
- Publishes proof to Mina testnet
- Receives real transaction ID
- Updates database: status='complete', transaction_id, verified_at, transaction_submitted_block_height
- Cleans up temp file
- **Assertions:**
  - Database status is 'complete'
  - Transaction ID matches Mina format: `/^5[A-Za-z0-9]{50,52}$/`
  - Transaction ID is not null or empty
  - verified_at timestamp is set
  - transaction_submitted_block_height > 0
  - Temp file `/tmp/${sha256Hash}.png` does not exist
  - Job state in pg-boss is 'completed'
  - Console logs Minascan link: `https://minascan.io/devnet/tx/${transactionId}`

**2. Real Image Hash Verification**
- Generate real SHA256 hash from image bytes
- Generate real ECDSA signature for the hash
- Process through full workflow with real ZK proof
- **Assertions:**
  - Proof generation succeeds with real image
  - SHA256 hash matches what o1js computes
  - Signature verification passes with real cryptography
  - Transaction publishes successfully

**3. zkApp Deployment Verification**
- Call `proofPublishingService.isDeployed()` against real testnet
- **Assertions:**
  - Returns `true` for deployed zkApp
  - Account has zkapp state defined
  - Console logs zkApp address

**4. Block Height Capture**
- Before transaction submission, capture current block height from testnet
- Submit transaction
- Save block height to database
- **Assertions:**
  - `transaction_submitted_block_height` is defined in database
  - Block height is > 0
  - Block height is reasonable (within recent testnet range)

**5. Transaction Format Validation**
- Submit real transaction to testnet
- Receive transaction ID
- **Assertions:**
  - Transaction ID starts with '5'
  - Transaction ID is 52 characters long
  - Transaction ID is base58 encoded
  - Transaction can be queried on Minascan

**6. Fee Payer and Token Owner Signing**
- Create transaction requiring two signers
- Sign with fee payer private key
- Sign with token owner private key
- **Assertions:**
  - Transaction is signed correctly (doesn't fail with signature error)
  - AccountUpdate.fundNewAccount is called
  - Fee payer pays for new account creation
  - Transaction successfully broadcasts

**7. Contract Compilation with Cache**
- Compile AuthenticityZkApp and BatchReducerUtils
- Use cache directory for compilation, ensure it's getting cleared and recreated for the tests
- **Assertions:**
  - Compilation completes without errors
  - Cache directory is used (faster on subsequent runs)
  - Performance tracking logs show compilation time

**8. Real Temp File Cleanup**
- Process job that generates real proof
- **Assertions:**
  - Temp file exists during processing
  - Temp file is deleted after completion
  - No temp files left in `/tmp/` directory after test

**9. Processing Status Updates**
- Enqueue job
- Monitor database during processing
- **Assertions:**
  - Status starts as 'awaiting_review'
  - Changes to 'processing' when worker starts
  - `processing_started_at` timestamp is set
  - Status changes to 'complete' after success

**10. Real Correlation ID Propagation**
- Enqueue job with correlation ID: 'real-e2e-test-12345'
- Capture logs during processing
- **Assertions:**
  - Correlation ID appears in worker start log
  - Correlation ID appears in proof generation log
  - Correlation ID appears in blockchain publishing log
  - Correlation ID appears in completion log
  - All logs can be traced with same correlation ID

**11. Token Owner Uniqueness**
- Create two submissions with different images
- Both complete successfully
- **Assertions:**
  - Each submission has unique token_owner_address
  - Each submission uses different tokenOwnerPrivateKey
  - No address collision between submissions

**12. Token Owner Derivation**
- Complete proof generation workflow
- Retrieve tokenOwnerPrivateKey used during processing
- **Assertions:**
  - Token owner address in database matches address derived from private key
  - Private key → public key → base58 address derivation is correct

**13. Token Owner in Transaction**
- Complete real transaction on testnet
- Query transaction details
- **Assertions:**
  - Transaction includes token owner signature
  - AccountUpdate shows token owner as signer
  - Fee payer funded new account for token owner

**Complexity:** High (real blockchain and ZK operations)

**Estimated Time:** 4-5 hours to implement

**Expected Runtime:** 3-5 minutes per test run

---

#### Test 1.2: Real Blockchain Monitoring

**File:** `test/integration/workflows/blockchain-monitoring-real.integration.test.ts`

**Purpose:** Validate blockchain monitoring with real testnet queries

**Execution:** Only runs when `RUN_SLOW_TESTS=true`

**Test Cases:**

**1. Real Archive Node Query**
- Query real Mina archive node for zkApp actions
- Use actual zkApp address from environment
- Query last 100 blocks
- **Assertions:**
  - Archive node responds without errors
  - Response contains actions array
  - Each action has blockInfo with height and distanceFromMaxBlockHeight
  - Each action has actionData with transactionInfo
  - Transaction hashes are in correct format

**2. Real Block Height Fetch**
- Use MinaNodeService to fetch current testnet block height
- Query via o1js fetchLastBlock
- **Assertions:**
  - Block height is returned as number
  - Block height > 0
  - Block height is reasonable for testnet
  - Console logs current block height

**3. Real Transaction Status Check**
- Create submission with real transaction ID (from previous test)
- Query archive node for transaction
- **Assertions:**
  - Transaction is found in archive
  - Transaction status is 'applied' or 'pending'
  - Block height is correct
  - Distance from max block height is calculated

**4. Performance Metrics**
- Query archive node and measure time
- **Assertions:**
  - Query completes in reasonable time (< 10 seconds)
  - Performance metrics logged (archiveQueryDurationMs)

**5. Block Height Cross-Reference**
- Use submission from Test 1.1 with known transaction_submitted_block_height
- Run monitoring job to find transaction in archive
- **Assertions:**
  - Transaction found at block height >= transaction_submitted_block_height
  - Monitoring correctly references submission block height
  - Distance calculation is accurate

**Complexity:** Medium

**Estimated Time:** 1.5-2.5 hours to implement

**Expected Runtime:** 30-60 seconds per test run

---

### Phase 2: Fast Workflow Tests (Mocked)

These tests use mocked ZK proof generation and blockchain publishing for fast feedback during development.

---

#### Test 2.1: ProofGenerationWorkflow Integration (Mocked)

**File:** `test/integration/workflows/proof-generation-workflow.integration.test.ts`

**Purpose:** Test complete proof generation workflow with mocked expensive operations for fast feedback

**Execution:** Default test mode (runs without `RUN_SLOW_TESTS`)

**Dependencies:**
- Real: pg-boss, PostgreSQL, MinIO, ImageAuthenticityService, SubmissionsRepository
- Mocked: ProofGenerationService, ProofPublishingService

**Test Cases:**

**1. Happy Path - Job Completion (Mocked)**
- Create submission with valid signature
- Enqueue job
- Worker processes with mocked proof generation (returns instantly)
- Mocked blockchain publish (returns 'mock-tx-hash-123')
- **Assertions:**
  - Status = 'complete'
  - transaction_id = 'mock-tx-hash-123'
  - verified_at is set
  - Temp file cleaned up
  - Job state = 'completed'
  - Mocked services called with correct parameters

**2. Signature Verification Failure**
- Create submission with invalid signature
- Enqueue job
- Worker processes and signature verification fails
- **Assertions:**
  - Status = 'rejected'
  - failure_reason contains 'ECDSA signature verification failed'
  - failed_at is set
  - Proof generation never called

**3. Retry Logic - Success After Failures**
- Mock proof generation to fail twice, succeed on third attempt
- Enqueue job
- **Assertions:**
  - Eventually completes with status = 'complete'
  - retry_count = 2
  - Proof generation called 3 times

**4. Retry Logic - All Retries Exhausted**
- Mock proof generation to always fail
- Enqueue job
- **Assertions:**
  - Final status = 'rejected'
  - retry_count = 3
  - Job state = 'failed'

**5. MinIO Download Failure**
- Enqueue job with invalid storage key
- Worker attempts download
- **Assertions:**
  - Status updated with error
  - failure_reason defined
  - Handled gracefully

**6. Correlation ID Propagation**
- Enqueue job with correlation ID
- **Assertions:**
  - Correlation ID in all log entries
  - Traceable through entire workflow

**7. Processing Status Updates**
- Enqueue job
- Check database immediately after worker picks up
- **Assertions:**
  - Status = 'processing'
  - processing_started_at is set
  - Later changes to 'complete'

**8. Temp File Cleanup on Failure**
- Mock proof generation to fail
- **Assertions:**
  - Temp file cleaned up even on failure
  - No temp files remain after processing

**9. Partial Failure Scenario**
- Mock proof generation to succeed
- Mock blockchain publishing to fail on first attempt, succeed on retry
- **Assertions:**
  - Proof generation called only once (not regenerated on retry)
  - Publishing called twice (initial + retry)
  - Eventually completes successfully
  - Retry count = 1

**10. Status Transitions During Retries**
- Mock proof generation to fail on first 2 attempts
- Monitor database status after each attempt
- **Assertions:**
  - After retry 1: status = 'awaiting_review', retry_count = 1
  - After retry 2: status = 'awaiting_review', retry_count = 2
  - After success: status = 'complete'
  - Never transitions directly from 'processing' to 'rejected' until final retry

**11. Auto-Generated Correlation ID**
- Create submission without providing correlationId
- Admin approves (enqueues job without correlationId)
- **Assertions:**
  - Worker generates correlation ID automatically
  - All worker logs include generated correlation ID
  - Database updates include correlation context

**12. Hash Mismatch Detection**
- Upload valid image to MinIO
- After upload, manually overwrite file in MinIO with different content
- Worker downloads modified file
- **Assertions:**
  - Worker detects hash mismatch
  - Status = 'rejected'
  - failure_reason contains 'hash mismatch' or similar
  - Job fails permanently (not retried)

**13. Invalid Image Format**
- Upload text file with .png extension
- **Assertions:**
  - Image verification fails
  - Status = 'rejected'
  - failure_reason indicates invalid format
  - Handled gracefully without crashes

**14. Concurrent Submissions to Same Chain**
- Create 3 submissions to same chain concurrently (Promise.all)
- All use valid but different images
- **Assertions:**
  - All 3 submissions created successfully
  - Chain positions are sequential: 1, 2, 3 (no duplicates)
  - Chain length incremented to 3
  - No race condition in position assignment

**15. MinIO Storage Cleanup After Success**
- Complete job successfully
- Query MinIO for storage_key
- **Assertions:**
  - File no longer exists in MinIO (or marked for cleanup)
  - Temp file cleaned up from /tmp/
  - Only database record remains

**16. Job Retention After Completion**
- Complete job successfully
- Query pg-boss for job record by jobId
- **Assertions:**
  - Job still exists in pg-boss
  - Job state = 'completed'
  - Job retained for audit trail (not immediately deleted)
  - Job data includes original correlationId

**Complexity:** High (full workflow orchestration)

**Estimated Time:** 8-10 hours to implement

**Expected Runtime:** < 45 seconds per test run

---

#### Test 2.2: BlockchainMonitoringWorkflow Integration (Mocked)

**File:** `test/integration/workflows/blockchain-monitoring-workflow.integration.test.ts`

**Purpose:** Test blockchain monitoring workflow with mocked network calls

**Execution:** Default test mode

**Dependencies:**
- Real: pg-boss, PostgreSQL, BlockchainMonitoringService, SubmissionsRepository
- Mocked: ArchiveNodeService, MinaNodeService

**Test Cases:**

**1. Transaction Categorization - Pending, Included, Final**
- Create submissions with transactions at different block heights
- Mock current height = 1000
- Mock archive response with some transactions found
- **Assertions:**
  - Pending: transactions < 15 blocks old, not found in archive
  - Included: found in archive with < 15 confirmations
  - Final: found in archive with ≥ 15 confirmations
  - Correct counts in log output

**2. Abandoned Transaction Detection**
- Create submission with transaction submitted 20 blocks ago
- Mock current height = 1000
- Transaction not found in archive
- **Assertions:**
  - Categorized as abandoned (> 15 blocks without inclusion)
  - Warning logged

**3. Archive Node Failure Handling**
- Mock archive node to throw error
- **Assertions:**
  - Error logged
  - Worker doesn't crash
  - Job marked as completed (non-fatal)

**4. High Pending Count Warning**
- Create 12 pending submissions
- **Assertions:**
  - Warning logged about high pending count

**5. Empty Monitoring (No Transactions)**
- No submissions in database
- **Assertions:**
  - Job completes successfully
  - All counts = 0

**6. Performance Metrics**
- Process monitoring job
- **Assertions:**
  - Log contains archiveQueryDurationMs
  - Log contains totalDurationMs

**7. Monitoring Correlation ID Propagation**
- Trigger monitoring job manually
- Verify correlation context in logs
- **Assertions:**
  - Monitoring job generates or receives correlation ID
  - All monitoring logs include correlation ID
  - Traceable through archive queries and status aggregation

**8. Empty Actions Array Handling**
- Mock archive node to return empty actions array
- Mock database to have transactions
- **Assertions:**
  - Monitoring completes without errors
  - All transactions categorized as 'pending' or 'abandoned'
  - No crashes on empty response

**9. Monitoring Job Singleton Key**
- Trigger monitoring job twice concurrently
- **Assertions:**
  - Only one job executes (singleton key prevents duplicates)
  - Second attempt either queued or rejected
  - No overlapping monitoring operations

**10. Manual Monitoring Trigger**
- Call jobQueue.enqueueMonitoringJob() directly
- **Assertions:**
  - Job enqueued successfully
  - Job executes and completes
  - Works independently of scheduled cron job

**Complexity:** Medium

**Estimated Time:** 4-5 hours to implement

**Expected Runtime:** < 15 seconds per test run

---

#### Test 2.3: ErrorRecoveryWorkflow Integration

**File:** `test/integration/workflows/error-recovery-workflow.integration.test.ts`

**Purpose:** Test error recovery and cleanup across workflows

**Execution:** Default test mode

**Test Cases:**

**1. Worker Crash and Resume**
- Start worker, enqueue job
- Simulate worker crash mid-processing
- Restart worker
- **Assertions:**
  - Job resumes on restart
  - Database state is consistent

**2. Singleton Key Prevents Duplicates**
- Enqueue same job twice with same sha256Hash
- **Assertions:**
  - Only one job created (pg-boss singleton key works)

**3. Database Connection Loss During Processing**
- Mock database to fail mid-processing
- **Assertions:**
  - Error handled gracefully
  - No data corruption

**4. MinIO Connection Loss**
- Mock MinIO to fail during upload/download
- **Assertions:**
  - Error handled gracefully
  - Appropriate retry behavior

**5. Cascade Delete Verification**
- Create challenge with chains and submissions
- Delete challenge
- **Assertions:**
  - All associated chains deleted (foreign key cascade)
  - All associated submissions deleted (foreign key cascade)
  - No orphaned records remain
  - MinIO files may remain (check cleanup policy)

**6. Invalid Status Transition Blocked**
- Create submission with status='complete'
- Attempt to update status to 'processing'
- **Assertions:**
  - Update rejected or fails
  - Status remains 'complete'
  - Error indicates invalid state transition

**Complexity:** Medium-High

**Estimated Time:** 3-4 hours to implement

 

## Implementation Order (Revised)

### Phase 1: Real End-to-End Tests (5-7 hours)
**Priority: HIGHEST - Implement First**
- ✓ `proof-generation-real.integration.test.ts` - **13 test cases** (added: token owner tests)
- ✓ `blockchain-monitoring-real.integration.test.ts` - **5 test cases** (added: block height cross-reference)
- ✓ Environment setup with real testnet credentials
- ✓ Verify zkApp deployment on testnet
- **Why first:** Validates that our system actually works before investing in mocked tests

### Phase 2: Test Helpers (1-2 hours)
- ✓ `worker-test-helpers.ts` - Core utilities for both real and mocked tests
- ✓ Mock setup functions
- ✓ Real test image generation
- ✓ MinIO manipulation utilities (for hash mismatch test)
- **Why second:** Enables both real and mocked tests with shared utilities

### Phase 3: Fast Mocked Workflow Tests (12-15 hours)
- ✓ `proof-generation-workflow.integration.test.ts` - **16 test cases** (added: 8 edge cases)
- ✓ `blockchain-monitoring-workflow.integration.test.ts` - **10 test cases** (added: 4 edge cases)
- ✓ `error-recovery-workflow.integration.test.ts` - **6 test cases** (added: 2 validation cases)
- **Why third:** Once real tests prove it works, add fast tests for development

### Phase 4: API Test Enhancements (30 minutes)
- ✓ Verify `submissions.integration.test.ts` includes admin approval idempotency
- ✓ Verify image retrieval tests exist (GET /api/submissions/:id/image)
- **Why last:** Quick verification that existing API tests are complete

**Total Estimated Time:** 19-25 hours

---

## Environment Variables

Add to `.env.test` or test configuration:

```bash
# Existing
TEST_API_URL=http://localhost:3000
TEST_ADMIN_USERNAME=admin
TEST_ADMIN_PASSWORD=serverpass
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/authenticity_test

# Worker test requirements
MINIO_ENDPOINT=http://localhost:9000
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_BUCKET=authenticity-test

# Real end-to-end test requirements (RUN_SLOW_TESTS=true)
TEST_ZKAPP_ADDRESS=B62qmXFNvz2sfYZDuHaY5htPGkx1u2E2Hn3rWuDWkE11mxRmpijYzWN
TEST_FEE_PAYER_PRIVATE_KEY=EKEzq...
TEST_MINA_NODE_ENDPOINT=https://api.minascan.io/node/devnet/v1/graphql
TEST_ARCHIVE_NODE_ENDPOINT=https://api.minascan.io/node/devnet/v1/graphql

# Optional
RUN_SLOW_TESTS=false  # Set to true to run real ZK proof tests
VERIFY_ON_CHAIN=false  # Optional: query archive node to verify tx inclusion
```

---

## Running the Tests

### Run real end-to-end tests (primary validation):
```bash
RUN_SLOW_TESTS=true npm run test:integration
# Runs in 5-10 minutes
# Includes real ZK proof generation and blockchain publishing
```

### Run fast mocked tests (default):
```bash
npm run test:integration
# Runs in < 2 minutes
# Skips all tests marked with RUN_SLOW_TESTS check
```

### Run only real tests:
```bash
RUN_SLOW_TESTS=true npx vitest run test/integration/workflows/proof-generation-real.integration.test.ts
```

### Run only fast mocked tests:
```bash
npx vitest run test/integration/workflows/ --exclude='**/*.real.integration.test.ts'
```

### Run specific workflow test:
```bash
npx vitest run test/integration/workflows/proof-generation-workflow.integration.test.ts
```

### CI/CD Strategy:
```yaml
# .github/workflows/test.yml

# Run on every PR (fast)
- name: Fast Integration Tests
  run: npm run test:integration

# Run nightly or on release (slow)
- name: Real End-to-End Tests
  if: github.event_name == 'schedule' || github.ref == 'refs/heads/main'
  run: RUN_SLOW_TESTS=true npm run test:integration
  env:
    TEST_ZKAPP_ADDRESS: ${{ secrets.TEST_ZKAPP_ADDRESS }}
    TEST_FEE_PAYER_PRIVATE_KEY: ${{ secrets.TEST_FEE_PAYER_PRIVATE_KEY }}
```

---

## Success Criteria

### Fast Mocked Tests (Default)
✅ All workflow tests pass in < 2 minutes
✅ Tests verify complete flows from trigger to completion
✅ Tests verify error handling and retry logic
✅ Tests verify database state changes correctly
✅ Tests verify MinIO operations work correctly
✅ Tests verify worker job processing with real pg-boss
✅ Tests verify correlation ID propagation and auto-generation
✅ Tests verify concurrent operations (race conditions)
✅ Tests verify status transition validation
✅ Tests verify partial failure scenarios
✅ Tests verify resource cleanup (temp files, MinIO)
✅ Tests verify data integrity (hash mismatch detection)
✅ Tests verify cascade deletes
✅ No redundant isolated service tests
✅ Fast feedback without slow ZK/blockchain operations
✅ Tests follow existing patterns and style
✅ No test pollution (proper cleanup after each test)
✅ Clear, readable test descriptions
✅ Meaningful assertions with good error messages

### Real End-to-End Tests (RUN_SLOW_TESTS=true)
✅ Real ZK proof generation completes successfully (30+ seconds)
✅ Real blockchain publishing to testnet works
✅ Transaction IDs match Mina format (5...)
✅ Block height captured correctly and cross-referenced in monitoring
✅ zkApp deployment verification works
✅ Real image hash verification with actual PNG files
✅ Token owner uniqueness and derivation verified
✅ Token owner signatures present in transactions
✅ Tests provide Minascan links for manual verification
✅ Optional on-chain verification via archive node queries
✅ Tests run in CI/CD nightly builds
✅ Clear console output showing real transactions

---

## Rationale for Workflow-Centric Approach

### Why Not Test Services in Isolation?

**Problem with isolated service tests:**
- Services don't run in isolation in production
- Testing in isolation doesn't prove the full workflow works
- Redundant testing (workflows test the same services)
- More maintenance burden (mock churn)

**Benefits of workflow tests:**
- Test the system as it actually runs
- Verify orchestration and integration
- Higher confidence in production behavior
- Single source of truth for integration testing
- Services tested implicitly through workflows

### What About Unit Tests?

**Unit tests still have a place:**
- Test pure logic without external dependencies
- Example: `BlockchainMonitoringService.aggregateTransactionStatus()` - pure data transformation
- Move `monitoring.service` test to `test/unit/services/monitoring.test.ts`

**But avoid "integration" tests for services:**
- Don't create `storage.integration.test.ts` - tested via workflow
- Don't create `jobQueue.integration.test.ts` - tested via workflow
- Don't create isolated ZK service tests - tested via workflow

### What About Repository Tests?

**Keep repository integration tests:**
- Complex SQL queries worth testing separately
- Example: `submissions.repository.integration.test.ts`
- Direct database interaction validation

---

## Test Plan Updates Summary

### Added Test Cases (20 new cases)

**Test 1.1 - Real E2E (3 additions):**
- Token owner uniqueness verification
- Token owner derivation from private key
- Token owner signature in transaction

**Test 1.2 - Real Monitoring (1 addition):**
- Block height cross-reference validation

**Test 2.1 - Mocked Proof Generation (8 additions):**
- Partial failure scenario (proof succeeds, publishing fails)
- Status transitions during retries
- Auto-generated correlation ID
- Hash mismatch detection (file tampering)
- Invalid image format handling
- Concurrent submissions to same chain
- MinIO cleanup after success
- Job retention verification

**Test 2.2 - Mocked Monitoring (4 additions):**
- Monitoring correlation ID propagation
- Empty actions array handling
- Monitoring job singleton key
- Manual monitoring trigger

**Test 2.3 - Error Recovery (2 additions):**
- Cascade delete verification
- Invalid status transition blocking

### Excluded Test Scenarios

**Moved to Unit Tests (require mocking):**
- MinIO upload succeeds → DB fails → cleanup verification
- Database transaction rollback scenarios
- Invalid fee payer key handling
- Archive node malformed response handling

**Moved to Chaos/Resilience Tests (infrastructure manipulation):**
- MinIO container unavailability
- Database connection loss during processing
- Worker crash and resume (already partially covered in Test 2.3)
- Network partition scenarios
- Container restart scenarios

**Excluded as Too Granular (implementation details):**
- Log format validation
- Log level verification
- Retry delay timing verification
- Correlation ID format validation
- HTTP header verification (caching, content-type)

**Excluded as Performance Tests (different category):**
- 100+ concurrent submission load testing
- Job queue backlog throughput
- Database connection pool stress testing
- End-to-end latency benchmarking

### Testing Philosophy

**Integration tests should:**
- Use real infrastructure (DB, MinIO, pg-boss)
- Test complete workflows end-to-end
- Use real data and realistic scenarios
- Be deterministic and reproducible
- Run in reasonable time (< 2 min for mocked, < 10 min for real)

**Integration tests should NOT:**
- Mock infrastructure failures (use chaos tests instead)
- Test implementation details (use unit tests instead)
- Require complex timing orchestration
- Be flaky or timing-dependent
- Test performance metrics (use load tests instead)

---

## Notes

- Workflow tests provide higher confidence than isolated service tests
- Mocking at service boundaries keeps tests fast
- Real workers and job queue test actual concurrency behavior
- Observable outcomes (DB, MinIO, logs) provide clear assertions
- Real end-to-end tests validate actual behavior before investing in mocked tests
- This approach tests the system as it actually runs in production
- Both test modes are essential - real tests for validation, fast tests for development
- 20 practical test cases added based on thorough code review and gap analysis
