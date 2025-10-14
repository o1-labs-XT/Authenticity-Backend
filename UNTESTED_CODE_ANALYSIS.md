# Untested Code Analysis: staging vs main

**Generated**: 2025-10-14
**Branch Comparison**: `main...staging`
**Total Files Changed**: 37 files with 3,077 insertions and 2,156 deletions

## Executive Summary

This document identifies all code changes between `main` and `staging` branches that require unit and integration tests. The changes fall into four major categories:

1. **New Blockchain Monitoring System** - Entirely new monitoring infrastructure
2. **ECDSA Signature Migration** - Complete migration from o1js signatures to ECDSA format
3. **Dual Database Updates** - Workers now update both `authenticity_records` and `submissions` tables
4. **Enhanced Transaction Tracking** - Added block height tracking and improved monitoring

---

## 1. New Blockchain Monitoring Services

### 1.1 ArchiveNodeService (`src/services/blockchain/archiveNode.service.ts`)

**Status**: ❌ **NO TESTS**

#### Functionality
- Queries Mina archive node via GraphQL to fetch blockchain actions
- Parses transaction status and block information
- Calculates distance from max block height

#### Required Tests

##### Unit Tests
- [ ] **Constructor initialization**
  - Verify endpoint is stored correctly

- [ ] **fetchActionsWithBlockInfo() - Success cases**
  - Should successfully fetch actions from archive node
  - Should correctly parse GraphQL response
  - Should return empty array when no actions found
  - Should handle empty response gracefully

- [ ] **fetchActionsWithBlockInfo() - Error cases**
  - Should throw error on non-OK HTTP response (4xx, 5xx)
  - Should throw error on GraphQL errors in response
  - Should throw error on network failures
  - Should log errors with correct context

- [ ] **fetchActionsWithBlockInfo() - Query construction**
  - Should construct correct GraphQL query with address
  - Should use correct height range (from/to)
  - Should include all required fields in query

##### Integration Tests
- [ ] **End-to-end archive node query**
  - Should successfully query real/mock archive node
  - Should handle pagination for large result sets
  - Should timeout appropriately on slow responses

---

### 1.2 MinaNodeService (`src/services/blockchain/minaNode.service.ts`)

**Status**: ❌ **NO TESTS**

#### Functionality
- Fetches current block height from Mina node using o1js `fetchLastBlock`
- Converts BigInt block height to number

#### Required Tests

##### Unit Tests
- [ ] **Constructor initialization**
  - Verify endpoint is stored correctly

- [ ] **getCurrentBlockHeight() - Success cases**
  - Should successfully fetch and return block height
  - Should correctly convert BigInt to number
  - Should handle large block heights
  - Should log debug information

- [ ] **getCurrentBlockHeight() - Error cases**
  - Should throw error when fetchLastBlock fails
  - Should throw error on network failures
  - Should log errors with correct context
  - Should handle timeout scenarios

##### Integration Tests
- [ ] **End-to-end block height fetch**
  - Should successfully fetch from real/mock Mina node
  - Should return valid block height number
  - Should handle node unavailability

---

### 1.3 BlockchainMonitoringService (`src/services/blockchain/monitoring.service.ts`)

**Status**: ❌ **NO TESTS**

#### Functionality
- Aggregates transaction status (pending/included/final/abandoned)
- Generates structured monitoring reports
- Calculates confirmations and abandonment logic
- Logs transaction status with samples

#### Required Tests

##### Unit Tests
- [ ] **aggregateTransactionStatus() - Transaction categorization**
  - Should correctly identify FINAL transactions (confirmations >= 15)
  - Should correctly identify INCLUDED transactions (confirmations < 15)
  - Should correctly identify PENDING transactions (not in archive response)
  - Should correctly identify ABANDONED transactions (pending > 15 blocks)

- [ ] **aggregateTransactionStatus() - Edge cases**
  - Should handle empty submitted transactions map
  - Should handle empty actions response
  - Should handle transactions with no block info
  - Should handle negative distanceFromMaxBlockHeight
  - Should handle zero confirmations

- [ ] **aggregateTransactionStatus() - Confirmation calculation**
  - Should use absolute value of distanceFromMaxBlockHeight
  - Should correctly calculate blocks since submission
  - Should handle currentHeight < submittedHeight edge case

- [ ] **aggregateTransactionStatus() - Summary counts**
  - Should return correct counts for all categories
  - Should sum to total submitted transactions
  - Should handle duplicate transaction hashes

- [ ] **logTransactionStatus() - Logging**
  - Should log complete monitoring report structure
  - Should include timestamp and block height
  - Should include transaction counts
  - Should sample first 3 transactions of each category
  - Should truncate transaction hashes to 8 characters

- [ ] **logTransactionStatus() - Warning conditions**
  - Should log warning when abandoned transactions found
  - Should log warning when pending count > 10
  - Should include abandoned hashes in warning

##### Integration Tests
- [ ] **End-to-end monitoring report generation**
  - Should generate valid report from real transaction data
  - Should handle large transaction sets (100+ transactions)
  - Should correctly categorize mixed transaction states

---

### 1.4 BlockchainMonitorWorker (`src/workers/blockchainMonitorWorker.ts`)

**Status**: ❌ **NO TESTS**

#### Functionality
- Processes blockchain monitoring jobs from pg-boss queue
- Coordinates between ArchiveNodeService, MinaNodeService, and MonitoringService
- Tracks performance metrics
- Handles job errors gracefully without crashing

#### Required Tests

##### Unit Tests
- [ ] **Constructor initialization**
  - Should store all dependencies correctly
  - Should store zkapp address

- [ ] **start() method**
  - Should register 'blockchain-monitoring' worker with pg-boss
  - Should log startup message

- [ ] **stop() method**
  - Should log stopping message

- [ ] **processMonitoringJob() - Success flow**
  - Should fetch current block height
  - Should load transactions from repository
  - Should query archive node with correct range
  - Should aggregate transaction status
  - Should log monitoring report
  - Should track performance metrics
  - Should use correlation ID from job

- [ ] **processMonitoringJob() - Error handling**
  - Should catch and log errors without throwing
  - Should not crash worker on error
  - Should track error in performance metrics

- [ ] **processMonitoringJob() - Lookback blocks**
  - Should use job.data.lookbackBlocks if provided
  - Should default to 100 blocks if not provided
  - Should calculate correct fromHeight and toHeight

##### Integration Tests
- [ ] **End-to-end monitoring job processing**
  - Should process real monitoring job from queue
  - Should update job status correctly
  - Should generate complete monitoring report
  - Should handle job retries on failure

---

### 1.5 Monitoring Worker Entry Point (`src/monitoringWorker.ts`)

**Status**: ❌ **NO TESTS**

#### Functionality
- Entry point for monitoring worker service
- Initializes all dependencies (database, pg-boss, services, worker)
- Schedules recurring monitoring job (every 5 minutes)
- Handles graceful shutdown on SIGTERM/SIGINT
- Handles uncaught exceptions and rejections

#### Required Tests

##### Unit Tests
- [ ] **startMonitoringWorker() - Initialization**
  - Should check monitoringEnabled config flag
  - Should exit early if monitoring disabled
  - Should initialize database connection
  - Should initialize pg-boss
  - Should initialize JobQueueService
  - Should initialize all blockchain services
  - Should start BlockchainMonitorWorker
  - Should schedule monitoring job

- [ ] **startMonitoringWorker() - Error handling**
  - Should clean up JobQueueService on error
  - Should clean up pg-boss on error
  - Should clean up database connection on error
  - Should exit with code 1 on fatal error
  - Should log fatal errors

- [ ] **Graceful shutdown**
  - Should handle SIGTERM signal
  - Should handle SIGINT signal
  - Should stop worker first
  - Should stop JobQueueService
  - Should stop pg-boss
  - Should close database connection
  - Should exit with code 0 on clean shutdown

- [ ] **Uncaught error handlers**
  - Should handle uncaught exceptions
  - Should handle unhandled rejections
  - Should exit with code 1

##### Integration Tests
- [ ] **End-to-end monitoring worker startup and shutdown**
  - Should successfully start all services
  - Should schedule first monitoring job
  - Should respond to shutdown signals
  - Should clean up all resources on shutdown

---

## 2. ECDSA Signature Migration

### 2.1 ImageAuthenticityService (`src/services/image/verification.service.ts`)

**Status**: ⚠️ **PARTIALLY TESTED** (existing tests updated, but new methods not fully tested)

#### Changes
- **New interface**: `ECDSASignatureData` with signatureR, signatureS, publicKeyX, publicKeyY (hex strings)
- **Changed method**: `verifyAndPrepareImage()` now accepts `ECDSASignatureData` instead of base58 strings
- **New method**: `parseSignatureData()` to validate and parse ECDSA components
- **Changed return**: Now returns `Bytes32` commitment instead of `Field`
- **Changed verification**: Uses `Ecdsa.verifySignedHash()` instead of `Signature.verify()`

#### Required Tests

##### Unit Tests
- [ ] **parseSignatureData() - Success cases**
  - Should accept valid hex strings (64 chars each)
  - Should return ECDSASignatureData object
  - Should handle uppercase and lowercase hex

- [ ] **parseSignatureData() - Validation errors**
  - Should error if signatureR is missing
  - Should error if signatureS is missing
  - Should error if publicKeyX is missing
  - Should error if publicKeyY is missing
  - Should error if any component is not valid hex
  - Should error if signatureR length !== 64
  - Should error if signatureS length !== 64
  - Should error if publicKeyX length !== 64
  - Should error if publicKeyY length !== 64
  - Should error on empty strings

- [ ] **verifyAndPrepareImage() - ECDSA verification**
  - Should successfully verify valid ECDSA signature
  - Should create Ecdsa object from signatureData
  - Should create Secp256r1 public key from coordinates
  - Should call verifySignedHash with commitment
  - Should return isValid: true on success
  - Should return verificationInputs with Bytes32 commitment
  - Should return commitment separately

- [ ] **verifyAndPrepareImage() - ECDSA verification failures**
  - Should return isValid: false on invalid signature
  - Should return error message on verification failure
  - Should handle invalid signature coordinates
  - Should handle invalid public key coordinates
  - Should catch and return errors from prepareImageVerification

- [ ] **verifyAndPrepareImage() - Commitment format**
  - Should return commitment as Bytes32 (not Field)
  - Should match expectedHash from prepareImageVerification

##### Integration Tests
- [ ] **End-to-end ECDSA signature verification**
  - Should verify real ECDSA signature from mobile app
  - Should reject invalid signatures
  - Should handle real image files
  - Should work with authenticity-zkapp library

---

### 2.2 ProofGenerationService (`src/services/zk/proofGeneration.service.ts`)

**Status**: ⚠️ **NEEDS UPDATES** (signature format changed)

#### Changes
- **Changed parameter**: Now accepts `ECDSASignatureData` instead of base58 strings
- **New parameter**: Now accepts `commitment: Bytes32` instead of deriving from verificationInputs
- **Changed construction**: Creates `Ecdsa` and `Secp256r1` objects from hex strings
- **Changed publicInputs**: Uses `Bytes32` commitment instead of `Field`

#### Required Tests

##### Unit Tests
- [ ] **generateProof() - ECDSA signature handling**
  - Should create Ecdsa object from signatureR and signatureS hex strings
  - Should create Secp256r1 public key from publicKeyX and publicKeyY hex strings
  - Should convert hex strings to BigInt correctly
  - Should prefix hex strings with '0x'

- [ ] **generateProof() - Commitment handling**
  - Should use provided Bytes32 commitment (not Field)
  - Should pass commitment to AuthenticityInputs

- [ ] **generateProof() - Proof generation**
  - Should compile AuthenticityProgram with cache
  - Should create valid AuthenticityInputs with ECDSA signature
  - Should create valid FinalRoundInputs with SHA256 state
  - Should generate proof successfully
  - Should track performance metrics

- [ ] **generateProof() - Error handling**
  - Should throw on invalid signature data
  - Should throw on invalid public key coordinates
  - Should throw on proof generation failures
  - Should track errors in performance metrics

##### Integration Tests
- [ ] **End-to-end ECDSA proof generation**
  - Should generate valid proof with ECDSA signature
  - Should work with real image and signature from mobile app
  - Should produce verifiable proof

---

### 2.3 ProofPublishingService (`src/services/zk/proofPublishing.service.ts`)

**Status**: ⚠️ **NEEDS UPDATES** (major changes)

#### Changes
- **New dependency**: `SubmissionsRepository` for dual database updates
- **New dependency**: `MinaNodeService` to capture block height
- **New field**: Captures `transaction_submitted_block_height` before transaction
- **Changed zkApp call**: `verifyAndStore()` now takes `tokenOwner`, `UInt8.from(0)`, and `proof` (removed publicInputs)
- **Dual updates**: Updates both `authenticity_records` and `submissions` tables
- **Added compilation**: Compiles `BatchReducerUtils` before zkApp

#### Required Tests

##### Unit Tests
- [ ] **Constructor initialization**
  - Should accept optional SubmissionsRepository
  - Should accept optional MinaNodeService
  - Should initialize Mina network correctly

- [ ] **publishProof() - Block height capture**
  - Should call minaNodeService.getCurrentBlockHeight() if available
  - Should log captured block height
  - Should proceed without block height if service unavailable
  - Should log warning on block height capture failure

- [ ] **publishProof() - Transaction creation**
  - Should compile BatchReducerUtils
  - Should set contract instance on BatchReducerUtils
  - Should compile AuthenticityZkApp with cache
  - Should call verifyAndStore with tokenOwner, UInt8.from(0), proof
  - Should fund new account from fee payer
  - Should prove and sign transaction

- [ ] **publishProof() - Database updates**
  - Should update authenticity_records if repository available
  - Should update submissions if submissionsRepository available
  - Should include transaction_id in updates
  - Should include transaction_submitted_block_height if captured
  - Should perform updates in parallel (Promise.all)
  - Should log successful updates

- [ ] **publishProof() - Error handling**
  - Should handle transaction failures
  - Should handle database update failures
  - Should track errors in performance metrics
  - Should throw ApiError with proper error code

##### Integration Tests
- [ ] **End-to-end proof publishing with block height**
  - Should successfully publish proof to blockchain
  - Should capture and save block height
  - Should update both databases correctly
  - Should handle transaction pending state

---

### 2.4 UploadHandler (`src/handlers/upload.handler.ts`)

**Status**: ⚠️ **NEEDS UPDATES** (validation changed)

#### Changes
- **Changed validation**: Now validates ECDSA components (signatureR, signatureS, publicKeyX, publicKeyY)
- **Removed validation**: No longer validates o1js base58 format
- **Changed storage**: Stores signature as JSON string `{r, s}` and publicKey as JSON string `{x, y}`
- **Changed job data**: Enqueues jobs with JSON-stringified signature and publicKey

#### Required Tests

##### Unit Tests
- [ ] **validateUploadRequest() - ECDSA validation**
  - Should call parseSignatureData with ECDSA components
  - Should return imageBuffer and signatureData on success
  - Should throw badRequest if file missing
  - Should throw badRequest if parseSignatureData returns error

- [ ] **uploadImage() - Request parsing**
  - Should extract signatureR, signatureS, publicKeyX, publicKeyY from body
  - Should pass components to validateUploadRequest

- [ ] **uploadImage() - Database storage**
  - Should store creatorPublicKey as JSON string `{"x": "...", "y": "..."}`
  - Should store signature as JSON string `{"r": "...", "s": "..."}`

- [ ] **uploadImage() - Job enqueuing**
  - Should enqueue with signature as JSON string
  - Should enqueue with publicKey as JSON string

- [ ] **uploadImage() - Error handling**
  - Should handle parseSignatureData errors
  - Should clean up file on signature validation failure

##### Integration Tests
- [ ] **End-to-end ECDSA upload**
  - Should accept valid ECDSA signature components
  - Should reject invalid hex formats
  - Should reject wrong lengths
  - Should create database record with JSON signature
  - Should enqueue proof generation job

---

### 2.5 SubmissionsHandler (`src/handlers/submissions.handler.ts`)

**Status**: ⚠️ **NEEDS UPDATES** (major changes)

#### Changes
- **Changed validation**: Now validates ECDSA components instead of o1js base58
- **Auto-enqueue**: Temporarily auto-enqueues proof generation jobs (commented TODO)
- **Disabled cleanup**: MinIO cleanup on error is disabled (commented TODO)
- **Changed storage**: Stores signature as JSON string

#### Required Tests

##### Unit Tests
- [ ] **validateSubmissionRequest() - ECDSA validation**
  - Should call parseSignatureData with ECDSA components
  - Should return imageBuffer and signatureData on success
  - Should throw badRequest on validation errors
  - Should validate wallet address format (base58 public key)

- [ ] **createSubmission() - Signature verification**
  - Should call verifyAndPrepareImage with signatureData
  - Should throw badRequest if verification fails
  - Should proceed if verification succeeds

- [ ] **createSubmission() - Database storage**
  - Should store signature as JSON string `{"r": "...", "s": "..."}`

- [ ] **createSubmission() - Job enqueuing (temporary)**
  - Should enqueue proof generation job immediately
  - Should use walletAddress as tokenOwnerAddress
  - Should generate random tokenOwnerPrivateKey (TODO: can remove)
  - Should store signature and publicKey as JSON strings

- [ ] **createSubmission() - Error handling**
  - Should NOT clean up MinIO on error (current behavior)
  - Should still clean up temp file

##### Integration Tests
- [ ] **End-to-end submission with ECDSA**
  - Should accept valid submission with ECDSA signature
  - Should verify signature before creating submission
  - Should enqueue proof generation job
  - Should return submission with status

---

### 2.6 ProofGenerationWorker (`src/workers/proofGenerationWorker.ts`)

**Status**: ⚠️ **NEEDS UPDATES** (major changes)

#### Changes
- **New dependency**: `SubmissionsRepository` for dual updates
- **Signature parsing**: Parses JSON signature and publicKey from job data
- **Dual updates**: Updates both `authenticity_records` and `submissions` tables in parallel
- **Status mapping**: Maps 'verified' → 'complete', 'failed' → 'rejected', 'pending' → 'awaiting_review' for submissions
- **Disabled cleanup**: No longer deletes from MinIO after processing (commented)

#### Required Tests

##### Unit Tests
- [ ] **processProofGenerationJob() - JSON parsing**
  - Should parse signature JSON `{"r": "...", "s": "..."}`
  - Should parse publicKey JSON `{"x": "...", "y": "..."}`
  - Should create ECDSASignatureData from parsed values
  - Should throw internal error on JSON parse failure

- [ ] **processProofGenerationJob() - Dual database updates**
  - Should update authenticity_records with status: 'processing'
  - Should update submissions with status: 'processing'
  - Should use Promise.all for parallel updates
  - Should include same processing_started_at timestamp
  - Should include same retry_count

- [ ] **processProofGenerationJob() - Success flow**
  - Should update authenticity_records with status: 'verified'
  - Should update submissions with status: 'complete'
  - Should include same verified_at timestamp
  - Should include same transaction_id

- [ ] **processProofGenerationJob() - Failure flow**
  - Should update authenticity_records with status: 'failed' or 'pending'
  - Should update submissions with status: 'rejected' or 'awaiting_review'
  - Should include same failed_at timestamp
  - Should include same failure_reason
  - Should include same retry_count

- [ ] **processProofGenerationJob() - MinIO cleanup**
  - Should NOT delete from MinIO after success (current behavior)
  - Should NOT delete from MinIO after failure (current behavior)
  - Should only delete temp file

- [ ] **processProofGenerationJob() - Error handling**
  - Should handle signature parsing errors
  - Should handle database update errors
  - Should handle verification errors with new ECDSA format

##### Integration Tests
- [ ] **End-to-end proof generation with ECDSA**
  - Should process job with JSON signature format
  - Should update both databases correctly
  - Should retain MinIO images (not delete)
  - Should handle retries correctly

---

## 3. Handler Repository Changes

### 3.1 StatusHandler (`src/handlers/status.handler.ts`)

**Status**: ⚠️ **NEEDS UPDATES** (repository changed)

#### Changes
- **Changed repository**: Now uses `SubmissionsRepository` instead of `AuthenticityRepository`
- **Status mapping**: Maps submission status to expected format (complete → verified, awaiting_review/processing/rejected → pending)
- **Removed field**: No longer returns tokenOwnerAddress (returns undefined)

#### Required Tests

##### Unit Tests
- [ ] **getStatus() - Repository usage**
  - Should call submissionsRepository.findBySha256Hash()
  - Should not call authenticityRepository methods

- [ ] **getStatus() - Status mapping**
  - Should map 'complete' → 'verified'
  - Should map 'awaiting_review' → 'pending'
  - Should map 'processing' → 'pending'
  - Should map 'rejected' → 'pending'

- [ ] **getStatus() - Response format**
  - Should return tokenOwnerAddress: undefined
  - Should return transaction_id if present
  - Should return mapped status

- [ ] **getStatus() - Error cases**
  - Should return 404 if submission not found
  - Should validate sha256Hash format

##### Integration Tests
- [ ] **End-to-end status check with submissions**
  - Should return correct status for submission records
  - Should handle missing records correctly

---

### 3.2 TokenOwnerHandler (`src/handlers/tokenOwner.handler.ts`)

**Status**: ⚠️ **NEEDS UPDATES** (repository changed)

#### Changes
- **Changed repository**: Now uses `SubmissionsRepository` instead of `AuthenticityRepository`
- **Status mapping**: Same mapping as StatusHandler
- **Removed field**: Returns tokenOwnerAddress: undefined

#### Required Tests

##### Unit Tests
- [ ] **getTokenOwner() - Repository usage**
  - Should call submissionsRepository.findBySha256Hash()
  - Should not call authenticityRepository methods

- [ ] **getTokenOwner() - Status mapping**
  - Should map 'complete' → 'verified'
  - Should map other statuses → 'pending'

- [ ] **getTokenOwner() - Response format**
  - Should return tokenOwnerAddress: undefined
  - Should return found: false if not found
  - Should return found: true with status if found

- [ ] **getTokenOwner() - Error cases**
  - Should validate sha256Hash format

##### Integration Tests
- [ ] **End-to-end token owner lookup**
  - Should work with submissions repository
  - Should return correct found status

---

### 3.3 AdminHandler (`src/handlers/admin.handler.ts`)

**Status**: ⚠️ **NEEDS UPDATES** (repository changed)

#### Changes
- **Changed repository**: Now uses `SubmissionsRepository` instead of `AuthenticityRepository`
- **Status update**: Updates to 'awaiting_review' instead of 'pending' on retry

#### Required Tests

##### Unit Tests
- [ ] **retryJob() - Repository usage**
  - Should call submissionsRepository.updateBySha256Hash()
  - Should update status to 'awaiting_review' (not 'pending')

- [ ] **getJobStats() - Should work with submissions**
  - Should return correct stats

- [ ] **getFailedJobs() - Should work with submissions**
  - Should call submissionsRepository.getFailedRecords()

- [ ] **getJobDetails() - Should work with submissions**
  - Should return job details

##### Integration Tests
- [ ] **End-to-end admin operations with submissions**
  - Should retry failed jobs correctly
  - Should get stats from submissions repository

---

## 4. Repository and Database Changes

### 4.1 SubmissionsRepository (`src/db/repositories/submissions.repository.ts`)

**Status**: ❌ **NO TESTS** (new methods)

#### New Methods
1. `findBySha256Hash(sha256Hash: string): Promise<Submission | null>`
2. `updateBySha256Hash(sha256Hash: string, updates: Partial<Submission>): Promise<Submission | null>`
3. `getStatusCounts(): Promise<Record<string, number>>`
4. `getFailedRecords(limit: number, offset: number): Promise<Submission[]>`
5. `getRecentTransactionsForMonitoring(lookbackBlocks: number): Promise<TransactionInfo[]>`

#### Required Tests

##### Unit Tests
- [ ] **findBySha256Hash()**
  - Should query by sha256_hash column
  - Should return Submission object if found
  - Should return null if not found
  - Should handle database errors

- [ ] **updateBySha256Hash()**
  - Should update by sha256_hash column
  - Should set updated_at timestamp
  - Should return updated Submission
  - Should return null if not found
  - Should handle partial updates
  - Should handle database errors

- [ ] **getStatusCounts()**
  - Should group by status column
  - Should return counts for each status
  - Should handle empty table
  - Should return correct Record<string, number>

- [ ] **getFailedRecords()**
  - Should filter by status: 'rejected'
  - Should order by failed_at desc
  - Should respect limit parameter
  - Should respect offset parameter
  - Should handle empty results

- [ ] **getRecentTransactionsForMonitoring()**
  - Should filter by NOT NULL transaction_id
  - Should filter by NOT NULL transaction_submitted_block_height
  - Should order by transaction_submitted_block_height desc
  - Should limit by lookbackBlocks * 10
  - Should map to TransactionInfo format
  - Should exclude records with null fields
  - Should handle empty results

##### Integration Tests
- [ ] **End-to-end repository operations**
  - Should create, find, and update submissions by hash
  - Should get accurate status counts
  - Should paginate failed records correctly
  - Should return correct transactions for monitoring

---

### 4.2 AuthenticityRepository (`src/db/repositories/authenticity.repository.ts`)

**Status**: ❌ **NO TESTS** (new method)

#### New Method
- `getRecentTransactionsForMonitoring(lookbackBlocks: number = 100)`

#### Required Tests

##### Unit Tests
- [ ] **getRecentTransactionsForMonitoring()**
  - Should call adapter.getRecentTransactionsWithTxId()
  - Should filter records with transaction_id
  - Should filter records with transaction_submitted_block_height
  - Should map to TransactionInfo format
  - Should exclude records with null transaction_id
  - Should exclude records with null block height
  - Should handle empty results
  - Should respect lookbackBlocks parameter

##### Integration Tests
- [ ] **End-to-end monitoring query**
  - Should return transactions with all required fields
  - Should order correctly for monitoring

---

### 4.3 PostgresAdapter (`src/db/adapters/PostgresAdapter.ts`)

**Status**: ❌ **NO TESTS** (new method)

#### New Method
- `getRecentTransactionsWithTxId(lookbackBlocks: number)`

#### Required Tests

##### Unit Tests
- [ ] **getRecentTransactionsWithTxId()**
  - Should filter by NOT NULL transaction_id
  - Should order by created_at desc
  - Should limit by lookbackBlocks * 2
  - Should return AuthenticityRecord[] array
  - Should handle empty results
  - Should construct correct Knex query

##### Integration Tests
- [ ] **End-to-end adapter query**
  - Should return records from database
  - Should respect limit based on lookback blocks

---

### 4.4 Database Schema Changes

**Status**: ❌ **NO TESTS** (schema changes)

#### New Migration: `migrations/20250924023140_add_processing_timestamps_to_submissions.ts`

Adds to `submissions` table:
- `transaction_submitted_block_height` (integer, nullable)
- `processing_started_at` (timestamp, nullable)
- `verified_at` (timestamp, nullable)
- `failed_at` (timestamp, nullable)

Also modifies `authenticity_records` table:
- `transaction_submitted_block_height` (integer, nullable)

#### Required Tests

##### Integration Tests
- [ ] **Migration up()**
  - Should add transaction_submitted_block_height to submissions
  - Should add processing_started_at to submissions
  - Should add verified_at to submissions
  - Should add failed_at to submissions
  - Should add transaction_submitted_block_height to authenticity_records
  - Should allow null values for all new fields
  - Should not break existing records

- [ ] **Migration down()**
  - Should remove all added columns
  - Should restore table to previous state

---

## 5. Job Queue Changes

### 5.1 JobQueueService (`src/services/queue/jobQueue.service.ts`)

**Status**: ❌ **NO TESTS** (new methods)

#### New Methods
1. `scheduleMonitoringJob()` - Schedule recurring monitoring every 5 minutes
2. `enqueueMonitoringJob(data: BlockchainMonitoringJobData)` - Manually enqueue monitoring job

#### New Interface
- `BlockchainMonitoringJobData` with `scheduledAt` and `lookbackBlocks`

#### Required Tests

##### Unit Tests
- [ ] **start() - Queue creation**
  - Should create 'blockchain-monitoring' queue
  - Should create 'proof-generation' queue

- [ ] **scheduleMonitoringJob()**
  - Should call boss.schedule with 'blockchain-monitoring'
  - Should use cron pattern '*/5 * * * *' (every 5 minutes)
  - Should include scheduledAt and lookbackBlocks in data
  - Should use singleton key 'blockchain-monitoring-singleton'
  - Should log success message
  - Should handle errors

- [ ] **enqueueMonitoringJob()**
  - Should call boss.send with 'blockchain-monitoring'
  - Should pass BlockchainMonitoringJobData
  - Should use singleton key 'blockchain-monitoring-manual'
  - Should return jobId
  - Should handle errors

- [ ] **enqueueMonitoringJob() - Singleton behavior**
  - Should not create duplicate jobs with same singleton key

##### Integration Tests
- [ ] **End-to-end monitoring job scheduling**
  - Should create recurring job in pg-boss
  - Should run job every 5 minutes
  - Should respect singleton constraint
  - Should manually enqueue jobs successfully

---

## 6. Configuration Changes

### 6.1 Config (`src/config/index.ts`)

**Status**: ❌ **NO TESTS** (new config fields)

#### New Config Fields
- `archiveNodeEndpoint` (default: Minascan devnet archive)
- `minaNodeEndpoint` (default: Minascan devnet node)
- `monitoringEnabled` (default: true)

#### Required Tests

##### Unit Tests
- [ ] **parseConfig() - Archive node endpoint**
  - Should use ARCHIVE_NODE_ENDPOINT env var if provided
  - Should default to Minascan devnet archive
  - Should be required in production

- [ ] **parseConfig() - Mina node endpoint**
  - Should use MINA_NODE_ENDPOINT env var if provided
  - Should default to Minascan devnet node
  - Should be required in production

- [ ] **parseConfig() - Monitoring enabled**
  - Should default to true
  - Should set to false if MONITORING_ENABLED='false'
  - Should handle various truthy/falsy values

---

## 7. Test File Changes

### 7.1 Existing Test Updates

The following test files were modified but need review for completeness:

- `test/handlers/upload.test.ts` - Updated for ECDSA but may be incomplete
- `test/integration/submissions.integration.test.ts` - Updated for ECDSA but may be incomplete
- `test/services/image-verification.test.ts` - Updated for ECDSA but may be incomplete

#### Required Review
- [ ] Review `upload.test.ts` for ECDSA coverage
- [ ] Review `submissions.integration.test.ts` for ECDSA and dual DB updates
- [ ] Review `image-verification.test.ts` for new parseSignatureData method

---

## 8. Critical Integration Test Scenarios

### 8.1 End-to-End ECDSA Flow
- [ ] Upload image with ECDSA signature → verify → generate proof → publish → monitor
- [ ] Verify both databases are updated at each step
- [ ] Verify block height is captured and stored
- [ ] Verify monitoring can track transaction through lifecycle

### 8.2 Monitoring System
- [ ] Schedule monitoring job → process job → generate report
- [ ] Verify transaction categorization (pending/included/final/abandoned)
- [ ] Verify monitoring runs every 5 minutes
- [ ] Verify monitoring doesn't crash on errors

### 8.3 Dual Database Consistency
- [ ] Verify authenticity_records and submissions stay in sync
- [ ] Test race conditions with concurrent updates
- [ ] Test rollback scenarios if one update fails

### 8.4 Migration and Backwards Compatibility
- [ ] Test migration adds new columns correctly
- [ ] Test existing records work with new null columns
- [ ] Test rollback migration

---

## 9. Test Priority Matrix

| Priority | Component | Reason |
|----------|-----------|--------|
| **P0** | ECDSA signature verification | Core security change - signature format completely changed |
| **P0** | Dual database updates | Data consistency risk - updates two tables |
| **P0** | ProofGenerationWorker ECDSA parsing | Job failures will break proof generation |
| **P1** | Monitoring service aggregation logic | Complex business logic with edge cases |
| **P1** | Block height tracking | New feature that affects transaction monitoring |
| **P1** | Repository new methods | Database integrity and query correctness |
| **P2** | Handler repository changes | Mostly straightforward repository swaps |
| **P2** | Config changes | Simple config additions with defaults |
| **P3** | Monitoring worker entry point | Mostly initialization logic |

---

## 10. Test Coverage Metrics

### Current Test Coverage (from diff)
- **Modified test files**: 3 files
- **New source files without tests**: 5 files
- **Modified source files with insufficient tests**: 12+ files

### Target Test Coverage
- **Unit test coverage**: 80%+ for all new code
- **Integration test coverage**: Key flows (ECDSA, monitoring, dual updates)
- **E2E test coverage**: Complete upload → verify → publish → monitor flow

---

## 11. Testing Strategy Recommendations

1. **Phase 1: Critical Path (P0)**
   - ECDSA signature verification unit tests
   - Dual database update tests
   - ProofGenerationWorker ECDSA parsing tests
   - End-to-end ECDSA flow integration test

2. **Phase 2: Monitoring System (P1)**
   - All monitoring service unit tests
   - Monitoring worker unit tests
   - Block height tracking tests
   - End-to-end monitoring integration test

3. **Phase 3: Repository & Handlers (P1-P2)**
   - All new repository methods
   - Handler repository changes
   - Config changes

4. **Phase 4: Edge Cases & Error Handling (P2-P3)**
   - Error scenarios for all components
   - Race conditions for dual updates
   - Monitoring error handling
   - Migration tests

---

## 12. Risk Assessment

### High Risk Areas
1. **ECDSA Migration**: Complete signature format change without comprehensive tests
2. **Dual Database Updates**: Race conditions, inconsistency risks, partial update failures
3. **JSON Signature Storage**: Parsing errors could break worker processing
4. **Block Height Tracking**: Off-by-one errors, timing issues

### Medium Risk Areas
1. **Monitoring Logic**: Complex aggregation and categorization logic
2. **Repository Changes**: Query correctness, null handling
3. **Handler Changes**: Status mapping errors, repository method calls

### Low Risk Areas
1. **Config Changes**: Simple additions with defaults
2. **Monitoring Worker Entry Point**: Standard initialization pattern

---

## Conclusion

**Total Untested Changes**:
- **5 new service files** (completely untested)
- **12+ modified files** (insufficient test coverage)
- **60+ new methods/functions** (no tests)
- **3 existing test files** (need review for completeness)

**Estimated Test Implementation Effort**:
- **3-5 days** for P0 critical tests
- **5-7 days** for complete coverage (P0-P3)

**Recommendation**: Prioritize P0 tests immediately before any production deployment. The ECDSA migration and dual database updates represent significant risk without proper test coverage.