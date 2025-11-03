# Challenge zkApp Deployment Implementation Plan  
 

## Overview
Modify the challenge creation flow to deploy a unique `AuthenticityZkApp` contract for each challenge instead of using a hardcoded zkApp address from environment variables. Since contract deployment is slow (60-120s) and can fail, we'll use the existing pg-boss job queue system to handle deployment asynchronously, similar to how proof generation works for submissions.

## Architecture Pattern Reference
This implementation follows the same pattern as **Submissions → Proof Generation**:
- **Submissions**: User submits → DB record created (`awaiting_review`) → Admin approves → Job enqueued → Worker processes → Status updated
- **Challenges** (NEW): Admin creates → DB record created (`pending_deployment`) → Job enqueued → Worker deploys contract → Status updated

## High-Level Flow

```
Admin Creates Challenge
         ↓
Challenge Record Created (status: 'pending_deployment')
         ↓
Contract Deployment Job Enqueued
         ↓
Admin Returns Challenge Response (with pending status)
         ↓
Worker Picks Up Job
         ↓
Contract Compilation & Deployment (~60-120s)
         ↓
Success: Update Challenge (status: 'active', zkapp_address, tx_hash)
Failure: Update Challenge (status: 'deployment_failed', failure_reason)
```

---

## 1. Database Schema Changes

### 1.1 New Migration: Add zkApp Fields to Challenges Table

**File**: `migrations/YYYYMMDDHHMMSS_add_zkapp_fields_to_challenges.ts`

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('challenges', (table) => {
    // zkApp deployment fields
    table.string('zkapp_address', 255).nullable();
    // Note: zkApp private key NOT stored - deployment is one-time operation
    table.string('deployment_transaction_hash', 100).nullable();
    table.string('deployment_job_id', 100).nullable();

    // Status tracking
    table.enum('deployment_status', [
      'pending_deployment',  // Initial state after challenge creation
      'deploying',          // Contract deployment in progress
      'active',             // Contract successfully deployed
      'deployment_failed',  // Contract deployment failed (terminal state)
    ]).notNullable().defaultTo('pending_deployment');

    // Timestamps
    table.timestamp('deployment_started_at').nullable();
    table.timestamp('deployment_completed_at').nullable();
    table.timestamp('deployment_failed_at').nullable();

    // Error tracking
    table.text('deployment_failure_reason').nullable();
    table.integer('deployment_retry_count').notNullable().defaultTo(0);

    // Indexes
    table.index('deployment_status');
    table.index('zkapp_address');
    table.index('deployment_job_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('challenges', (table) => {
    table.dropColumn('zkapp_address');
    table.dropColumn('deployment_transaction_hash');
    table.dropColumn('deployment_job_id');
    table.dropColumn('deployment_status');
    table.dropColumn('deployment_started_at');
    table.dropColumn('deployment_completed_at');
    table.dropColumn('deployment_failed_at');
    table.dropColumn('deployment_failure_reason');
    table.dropColumn('deployment_retry_count');
  });
}
```

### 1.2 Update Challenge Type Definition

**File**: `src/db/types/touchgrass.types.ts`

```typescript
export interface Challenge {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  participant_count: number;
  chain_count: number;

  // zkApp deployment fields (NEW)
  zkapp_address?: string | null;
  deployment_transaction_hash?: string | null;
  deployment_job_id?: string | null;
  deployment_status: 'pending_deployment' | 'deploying' | 'active' | 'deployment_failed';
  deployment_started_at?: string | null;
  deployment_completed_at?: string | null;
  deployment_failed_at?: string | null;
  deployment_failure_reason?: string | null;
  deployment_retry_count: number;

  created_at: string;
  updated_at: string;
}
```

---

## 2. Job Queue Service Updates

### 2.1 Add Contract Deployment Job Type

**File**: `src/services/queue/jobQueue.service.ts`

```typescript
// REVISED: Simplified job data interface
export interface ContractDeploymentJobData {
  challengeId: string;
  correlationId?: string;
}

export class JobQueueService {
  // ... existing code ...

  async start(): Promise<void> {
    await this.boss.start();

    // Create queues if they don't exist
    await this.boss.createQueue('proof-generation');
    await this.boss.createQueue('blockchain-monitoring');
    await this.boss.createQueue('contract-deployment'); // NEW
    logger.info('Job queue started');
  }

  async enqueueContractDeployment(data: ContractDeploymentJobData): Promise<string> {
    try {
      const jobId = await this.boss.send('contract-deployment', data, {
        retryLimit: 3,              // 3 attempts total
        retryDelay: 120,            // 2 minutes between retries
        retryBackoff: true,         // Exponential backoff (2min, 4min, 8min)
        singletonKey: data.challengeId, // Prevent duplicate deployment jobs
        expireInHours: 24,          // Job expires after 24 hours
        priority: data.priority,    // Optional priority
      });

      logger.info(
        { jobId, challengeId: data.challengeId },
        'Contract deployment job enqueued'
      );
      return jobId || '';
    } catch (error) {
      logger.error({ err: error, challengeId: data.challengeId }, 'Failed to enqueue deployment job');
      throw error;
    }
  }
}
```

---

## 3. Contract Deployment Worker

### 3.0 Compilation Strategy

**Pre-compilation at Worker Startup:**
- Run `compile-zkapp.ts` script before starting worker (via `npm run start:deployment`)
- Compiles AuthenticityProgram and AuthenticityZkApp into cache directory
- Cache is reused across all deployments for fast loading

**Per-Deployment Compilation:**
- BatchReducerUtils compiled for each deployment with the actual zkApp instance
- Follows proven pattern from `proofPublishing.service.ts`
- Ensures BatchReducerUtils is properly bound to the specific zkApp being deployed

**Future Optimization (TODO):**
- Investigate if BatchReducerUtils can be compiled once at startup with a dummy instance
- Would speed up deployments but needs verification that it works correctly

### 3.1 Create Deployment Service

**File**: `src/services/zk/contractDeployment.service.ts`

```typescript
import { Mina, PrivateKey, AccountUpdate, Cache } from 'o1js';
import {
  AuthenticityZkApp,
  BatchReducerUtils,
} from 'authenticity-zkapp';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';

export interface DeploymentResult {
  success: boolean;
  zkAppAddress?: string;
  txHash?: string;
  error?: string;
}

export class ContractDeploymentService {
  constructor(private readonly feePayerPrivateKey: string) {}

  /**
   * Deploy a new AuthenticityZkApp contract
   *
   * Compilation Strategy:
   * - AuthenticityProgram and AuthenticityZkApp are pre-compiled at worker startup
   *   via compile-zkapp.ts script (loaded from cache during deployment)
   * - BatchReducerUtils is compiled per-deployment with the actual zkApp instance
   *   to ensure proper binding (follows proven pattern from proofPublishing.service.ts)
   *
   * TODO: Investigate if BatchReducerUtils can be compiled once at startup with a
   * dummy instance to speed up deployments. Current approach is safe but slower.
   */
  async deployContract(challengeId: string): Promise<DeploymentResult> {
    try {
      logger.info({ challengeId }, 'Starting contract deployment');

      // Connect to network using MINA_NODE_ENDPOINT from config
      const Network = Mina.Network(config.minaNodeEndpoint);
      Mina.setActiveInstance(Network);
      logger.info({ endpoint: config.minaNodeEndpoint }, 'Connected to Mina network');

      // Load fee payer
      const feePayerKey = PrivateKey.fromBase58(this.feePayerPrivateKey);
      const feePayerPublicKey = feePayerKey.toPublicKey();
      logger.debug({ feePayerAddress: feePayerPublicKey.toBase58() }, 'Fee payer loaded');

      // Generate random zkApp key for this challenge
      const zkAppKey = PrivateKey.random();
      const zkAppAddress = zkAppKey.toPublicKey();
      logger.info({ zkAppAddress: zkAppAddress.toBase58() }, 'Generated zkApp address');

      // Create zkApp instance and bind BatchReducer
      const zkApp = new AuthenticityZkApp(zkAppAddress);
      BatchReducerUtils.setContractInstance(zkApp);

      // Compile AuthenticityZkApp (should load from cache)
      const cache = Cache.FileSystem(config.circuitCachePath);
      logger.info('Loading AuthenticityZkApp from cache');
      await AuthenticityZkApp.compile({ cache });

      // Compile BatchReducerUtils with the actual instance (per-deployment)
      logger.info('Compiling BatchReducerUtils with zkApp instance');
      const batchCompileStart = Date.now();
      await BatchReducerUtils.compile();
      logger.info(
        { durationMs: Date.now() - batchCompileStart },
        'BatchReducerUtils compiled'
      );

      // Create deployment transaction
      // NOTE: Verify 0.1 MINA fee is sufficient for devnet/mainnet deployments
      // May need adjustment based on network conditions
      logger.info('Creating deployment transaction');
      const deployTxn = await Mina.transaction(
        { sender: feePayerPublicKey, fee: 0.1e9 },
        async () => {
          AccountUpdate.fundNewAccount(feePayerPublicKey);
          await zkApp.deploy();
        }
      );

      // Generate proof
      logger.info('Generating deployment proof');
      const proveStart = Date.now();
      await deployTxn.prove();
      logger.info(
        { durationMs: Date.now() - proveStart },
        'Deployment proof generated'
      );

      // Sign and send
      logger.info('Signing and sending transaction');
      const signedTxn = deployTxn.sign([feePayerKey, zkAppKey]);
      const txnResult = await signedTxn.send();

      if (txnResult.status === 'pending') {
        logger.info(
          { txHash: txnResult.hash, zkAppAddress: zkAppAddress.toBase58() },
          'Contract deployment transaction sent'
        );

        return {
          success: true,
          zkAppAddress: zkAppAddress.toBase58(),
          txHash: txnResult.hash,
        };
      } else {
        throw new Error(`Transaction failed with status: ${txnResult.status}`);
      }
    } catch (error) {
      logger.error({ err: error, challengeId }, 'Contract deployment failed');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
```

### 3.2 Create Contract Deployment Worker

**File**: `src/workers/contractDeploymentWorker.ts`

```typescript
import PgBoss from 'pg-boss';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import { ContractDeploymentService } from '../services/zk/contractDeployment.service.js';
import { ContractDeploymentJobData } from '../services/queue/jobQueue.service.js';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';
import { config } from '../config/index.js';

export class ContractDeploymentWorker {
  constructor(
    private boss: PgBoss,
    private challengesRepository: ChallengesRepository,
    private deploymentService: ContractDeploymentService
  ) {}

  async start(): Promise<void> {
    logger.info('Contract deployment worker starting');

    await this.boss.work<ContractDeploymentJobData>(
      'contract-deployment',
      {
        teamSize: 1,          // Single worker instance
        teamConcurrency: 1,   // One deployment at a time (memory-intensive)
        includeMetadata: true,
      },
      async (jobs: PgBoss.JobWithMetadata<ContractDeploymentJobData>[]) => {
        for (const job of jobs) {
          const retryCount = job.retryCount || 0;

          await withContext(
            {
              jobId: job.id,
              challengeId: job.data.challengeId,
              correlationId: job.data.correlationId,
              attempt: retryCount,
            },
            async () => {
              const jobTracker = new PerformanceTracker('job.contractDeployment', {
                challengeId: job.data.challengeId,
              });
              logger.info('Starting contract deployment job');

              const { challengeId } = job.data;

              // REVISED: Query challenge for logging context (removed from job data)
              let challenge;
              try {
                challenge = await this.challengesRepository.findById(challengeId);
                if (challenge) {
                  logger.info(
                    { challengeTitle: challenge.title },
                    'Deploying contract for challenge'
                  );
                }
              } catch (error) {
                logger.warn({ err: error }, 'Failed to fetch challenge details for logging');
              }

              try {
                // Update status to deploying
                await this.challengesRepository.update(challengeId, {
                  deployment_status: 'deploying',
                  deployment_started_at: new Date().toISOString(),
                  deployment_retry_count: retryCount,
                });

                // Deploy contract
                logger.info({ challengeId }, 'Deploying contract');
                const result = await this.deploymentService.deployContract(challengeId);

                if (!result.success) {
                  throw new Error(result.error || 'Unknown deployment error');
                }

                // Update challenge with deployment success
                await this.challengesRepository.update(challengeId, {
                  deployment_status: 'active',
                  zkapp_address: result.zkAppAddress,
                  deployment_transaction_hash: result.txHash,
                  deployment_completed_at: new Date().toISOString(),
                  deployment_failure_reason: null,
                });

                jobTracker.end('success', {
                  zkAppAddress: result.zkAppAddress,
                  txHash: result.txHash,
                });
                logger.info(
                  { zkAppAddress: result.zkAppAddress, txHash: result.txHash },
                  'Contract deployment completed successfully'
                );
              } catch (error) {
                const isLastRetry = retryCount >= config.workerRetryLimit - 1;

                logger.error(
                  { err: error, isLastRetry },
                  'Contract deployment failed'
                );

                // Update failure status
                const failureReason =
                  error instanceof Error ? error.message : String(error);

                await this.challengesRepository.update(challengeId, {
                  deployment_status: isLastRetry ? 'deployment_failed' : 'deploying',
                  deployment_failed_at: isLastRetry ? new Date().toISOString() : null,
                  deployment_failure_reason: failureReason,
                  deployment_retry_count: retryCount + 1,
                });

                // Re-throw to trigger pg-boss retry
                throw error;
              }
            }
          );
        }
      }
    );

    logger.info('Contract deployment worker started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping contract deployment worker...');
  }
}
```

### 3.3 Create Worker Entry Point

**File**: `src/startContractDeploymentWorker.ts`

```typescript
import PgBoss from 'pg-boss';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { DatabaseConnection } from './db/database.js';
import { ChallengesRepository } from './db/repositories/challenges.repository.js';
import { ContractDeploymentService } from './services/zk/contractDeployment.service.js';
import { ContractDeploymentWorker } from './workers/contractDeploymentWorker.js';

async function main() {
  logger.info('Starting contract deployment worker...');

  let boss: PgBoss | null = null;
  let dbConnection: DatabaseConnection | null = null;

  try {
    // Initialize database
    dbConnection = new DatabaseConnection({
      connectionString: config.databaseUrl,
    });
    await dbConnection.initialize();
    const challengesRepo = new ChallengesRepository(dbConnection.getAdapter());

    // Initialize pg-boss
    boss = new PgBoss(config.databaseUrl);
    await boss.start();
    logger.info('Job queue connected');

    // Initialize deployment service
    const deploymentService = new ContractDeploymentService(config.feePayerPrivateKey);

    // Initialize and start worker
    const worker = new ContractDeploymentWorker(boss, challengesRepo, deploymentService);
    await worker.start();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');
      await worker.stop();
      if (boss) await boss.stop();
      if (dbConnection) await dbConnection.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start worker');
    if (boss) await boss.stop();
    if (dbConnection) await dbConnection.close();
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught Exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled Rejection');
  process.exit(1);
});

main().catch((error) => {
  logger.fatal({ err: error }, 'Fatal error in contract deployment worker');
  process.exit(1);
});
```

---

## 4. Handler Updates

### 4.1 Update ChallengesHandler.createChallenge()

**File**: `src/handlers/challenges.handler.ts`

```typescript
export class ChallengesHandler {
  constructor(
    private readonly challengesRepo: ChallengesRepository,
    private readonly jobQueue: JobQueueService // NEW dependency
  ) {}

  async createChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { title, description, startTime, endTime } = req.body;

      // Validation (existing)
      if (!title) throw Errors.badRequest('title is required', 'title');
      if (!description) throw Errors.badRequest('description is required', 'description');
      if (!startTime) throw Errors.badRequest('startTime is required', 'startTime');
      if (!endTime) throw Errors.badRequest('endTime is required', 'endTime');

      const start = new Date(startTime);
      const end = new Date(endTime);

      if (end <= start) {
        throw Errors.badRequest('endTime must be after startTime');
      }

      // Create challenge record with pending deployment status
      const challenge = await this.challengesRepo.create({
        title,
        description,
        start_time: start,
        end_time: end,
      });

      logger.info({ challengeId: challenge.id }, 'Challenge created, enqueueing deployment');

      const jobId = await this.jobQueue.enqueueContractDeployment({
        challengeId: challenge.id,
        correlationId: (req as Request & { correlationId: string }).correlationId,
      });

      // Update challenge with job ID
      await this.challengesRepo.update(challenge.id, {
        deployment_job_id: jobId,
      });

      logger.info(
        { challengeId: challenge.id, jobId },
        'Contract deployment job enqueued'
      );

      // Return challenge with pending deployment status
      res.status(201).json(this.toResponse(challenge));
    } catch (error) {
      next(error);
    }
  }
}
```

### 4.2 Update ChallengeResponse Interface

**File**: `src/handlers/challenges.handler.ts`

```typescript
export interface ChallengeResponse {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  participantCount: number;
  chainCount: number;

  // zkApp deployment fields (NEW)
  zkAppAddress?: string;
  deploymentStatus: 'pending_deployment' | 'deploying' | 'active' | 'deployment_failed';
  deploymentTransactionHash?: string;
  deploymentFailureReason?: string;
  deploymentRetryCount: number;

  createdAt: Date;
  updatedAt: Date;
}

private toResponse(challenge: Challenge): ChallengeResponse {
  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    startTime: new Date(challenge.start_time),
    endTime: new Date(challenge.end_time),
    participantCount: challenge.participant_count,
    chainCount: challenge.chain_count,

    // zkApp deployment fields
    zkAppAddress: challenge.zkapp_address || undefined,
    deploymentStatus: challenge.deployment_status,
    deploymentTransactionHash: challenge.deployment_transaction_hash || undefined,
    deploymentFailureReason: challenge.deployment_failure_reason || undefined,
    deploymentRetryCount: challenge.deployment_retry_count,

    createdAt: new Date(challenge.created_at),
    updatedAt: new Date(challenge.updated_at),
  };
}
```

---

## 5. Configuration Updates

### 5.1 Configuration Notes

**No new environment variables required** - the deployment worker uses existing configuration:
- `DATABASE_URL` - for database connection
- `MINA_NETWORK` - testnet or mainnet (informational)
- `MINA_NODE_ENDPOINT` - network endpoint URL (e.g., `https://api.minascan.io/node/devnet/v1/graphql`)
- `FEE_PAYER_PRIVATE_KEY` - to pay deployment fees

**Notes**:
- zkApp private keys are **NOT** stored in the database. They are generated randomly during deployment and discarded after the transaction is sent.
- Deployment fee is hardcoded to 0.1 MINA - **verify this is sufficient for your network**
- The `MINA_NODE_ENDPOINT` must match your `MINA_NETWORK` setting

---

## 6. Repository Updates

### 6.1 Add Update Method to ChallengesRepository

**File**: `src/db/repositories/challenges.repository.ts`

```typescript
export class ChallengesRepository {
  // ... existing methods ...

  async update(id: string, data: Partial<Challenge>): Promise<Challenge | null> {
    const [updated] = await this.db
      .getKnex()('challenges')
      .where('id', id)
      .update({
        ...data,
        updated_at: this.db.getKnex().fn.now(),
      })
      .returning('*');

    return updated || null;
  }
}
```

---

## 7. Submissions Handler Updates

### 7.1 Validate Challenge Deployment Status on Submission Creation

**File**: `src/handlers/submissions.handler.ts`

In the `createSubmission()` method, add validation after checking if challenge is active:

```typescript
async createSubmission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // ... existing validation ...

    // Get chain and challenge
    const chain = await this.chainsRepo.findById(chainId!);
    if (!chain) {
      throw Errors.notFound('Chain');
    }
    const challenge = await this.challengesRepo.findById(chain.challenge_id);
    if (!challenge) {
      throw Errors.notFound('Challenge');
    }

    // Verify challenge is active (existing check)
    const now = new Date();
    const startTime = new Date(challenge.start_time);
    const endTime = new Date(challenge.end_time);
    if (now < startTime || now >= endTime) {
      throw Errors.badRequest('Challenge is not currently active');
    }

    // NEW: Verify challenge zkApp is deployed
    if (challenge.deployment_status !== 'active' || !challenge.zkapp_address) {
      throw Errors.badRequest(
        'Challenge zkapp is not yet deployed. Please try again shortly.',
        'challenge'
      );
    }

    // ... rest of submission creation logic ...
  }
}
```

### 7.2 Use Challenge-Specific zkApp Address on Admin Review

**File**: `src/handlers/submissions.handler.ts`

In the `reviewSubmission()` method, validate deployment status before enqueueing proof generation:

```typescript
async reviewSubmission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // ... existing validation ...

    // Enqueue proof generation job if approved
    if (challengeVerified) {
      // Get challenge to retrieve zkApp address
      const chain = await this.chainsRepo.findById(submission.chain_id);
      const challenge = await this.challengesRepo.findById(chain.challenge_id);

      // Validate challenge has deployed zkApp
      if (challenge.deployment_status !== 'active' || !challenge.zkapp_address) {
        throw Errors.badRequest(
          'Challenge zkApp is not yet deployed. Please wait for deployment to complete.',
          'challenge'
        );
      }

      const jobId = await this.jobQueue.enqueueProofGeneration({
        sha256Hash: submission.sha256_hash,
        signature: submission.signature,
        storageKey: submission.storage_key,
        tokenOwnerAddress: submission.wallet_address,
        tokenOwnerPrivateKey: PrivateKey.random().toBase58(),
        zkAppAddress: challenge.zkapp_address, // NEW: pass challenge-specific zkApp
        uploadedAt: new Date(submission.created_at),
        correlationId: (req as Request & { correlationId: string }).correlationId,
      });

      // ... rest of logic ...
    }
  }
}
```

---

## 8. Proof Publishing Service Updates (MAJOR REFACTORING)

### 8.1 Make ProofPublishingService Stateless

**REVISED: Complete refactoring to make service stateless and support dynamic zkApp addresses**

**File**: `src/services/zk/proofPublishing.service.ts`

```typescript
import {
  AuthenticityZkApp,
  AuthenticityProof,
  AuthenticityInputs,
  BatchReducerUtils,
} from 'authenticity-zkapp';
import { Mina, PublicKey, PrivateKey, AccountUpdate, fetchAccount, UInt8, Cache } from 'o1js';
import { SubmissionsRepository } from '../../db/repositories/submissions.repository.js';
import { MinaNodeService } from '../blockchain/minaNode.service.js';
import { logger } from '../../utils/logger.js';
import { Errors } from '../../utils/errors.js';
import { PerformanceTracker } from '../../utils/performance.js';
import { config } from '../../config/index.js';

// REVISED: Service is now stateless - no instance variables for zkApp
export class ProofPublishingService {
  constructor(
    private feePayerKey: string,
    private network: string,
    private submissionsRepository?: SubmissionsRepository,
    private minaNodeService?: MinaNodeService
  ) {
    // Initialize network once in constructor
    this.setupNetwork(this.network);
  }

  /**
   * Setup the Mina network connection using MINA_NODE_ENDPOINT from config
   */
  private setupNetwork(network: string): void {
    // REVISED: Use config.minaNodeEndpoint instead of hardcoded URLs
    const Network = Mina.Network(config.minaNodeEndpoint);
    Mina.setActiveInstance(Network);
    logger.info({
      network,
      endpoint: config.minaNodeEndpoint
    }, 'Connected to Mina network');
  }

  /**
   * REVISED: Publish a proof to a specific zkApp address
   * zkAppAddress is now a parameter, making this service reusable across challenges
   */
  async publishProof(
    sha256Hash: string,
    proof: AuthenticityProof,
    publicInputs: AuthenticityInputs,
    tokenOwnerPrivateKey: string,
    zkAppAddress: string // NEW: zkApp address per proof
  ): Promise<string> {
    // Check if zkApp is deployed
    const isDeployed = await this.isDeployed(zkAppAddress);
    if (!isDeployed) {
      throw Errors.internal(`AuthenticityZkApp at ${zkAppAddress} is not deployed`);
    }

    if (!this.feePayerKey) {
      throw Errors.internal('Fee payer private key not configured');
    }

    logger.info({ sha256Hash, zkAppAddress }, 'Publishing proof to blockchain');

    // Create zkApp instance for this specific address
    const zkAppPublicKey = PublicKey.fromBase58(zkAppAddress);
    const zkApp = new AuthenticityZkApp(zkAppPublicKey);

    // Compile contracts
    const cache = Cache.FileSystem(config.circuitCachePath);
    const compileTracker = new PerformanceTracker('publish.compile');

    // Set contract instance and compile BatchReducerUtils
    BatchReducerUtils.setContractInstance(zkApp);
    await BatchReducerUtils.compile();
    await AuthenticityZkApp.compile({ cache });

    compileTracker.end('success');

    // Parse addresses and keys
    const tokenOwnerPrivate = PrivateKey.fromBase58(tokenOwnerPrivateKey);
    const tokenOwner = tokenOwnerPrivate.toPublicKey();
    const feePayer = PrivateKey.fromBase58(this.feePayerKey);

    logger.debug(
      {
        feePayer: feePayer.toPublicKey().toBase58(),
        tokenOwner: tokenOwner.toBase58(),
        zkAppAddress,
        creator: `(${proof.publicInput.publicKey.x.toBigInt()}, ${proof.publicInput.publicKey.y.toBigInt()})`,
      },
      'Transaction participants'
    );

    logger.debug('Creating transaction...');

    // Capture current block height before submitting transaction
    let submittedBlockHeight: number | undefined;
    if (this.minaNodeService) {
      try {
        submittedBlockHeight = await this.minaNodeService.getCurrentBlockHeight();
        logger.debug(
          { submittedBlockHeight },
          'Captured current block height before transaction submission'
        );
      } catch (error) {
        logger.warn(
          { err: error },
          'Failed to capture current block height, proceeding without it'
        );
      }
    }

    try {
      // Create transaction to verify and store the proof on-chain
      const txn = await Mina.transaction({ sender: feePayer.toPublicKey(), fee: 1e9 }, async () => {
        // Fund the new token account
        AccountUpdate.fundNewAccount(feePayer.toPublicKey());

        // Call verifyAndStore on the zkApp
        await zkApp.verifyAndStore(tokenOwner, UInt8.from(0), proof);
      });

      logger.debug('Proving transaction...');
      const proveTracker = new PerformanceTracker('publish.prove');
      await txn.prove();
      proveTracker.end('success');

      logger.debug('Signing and sending transaction...');
      const signers = [feePayer, tokenOwnerPrivate];
      logger.debug(`Signing transaction with ${signers.length} signers`);
      const sendTracker = new PerformanceTracker('publish.send');
      const pendingTxn = await txn.sign(signers).send();
      sendTracker.end('success', { hash: pendingTxn.hash });

      logger.info({ transactionHash: pendingTxn.hash }, 'Transaction sent');

      // Save transaction ID and block height to database
      if (this.submissionsRepository) {
        const updateData: { transaction_id: string; transaction_submitted_block_height?: number } =
          {
            transaction_id: pendingTxn.hash,
          };

        if (submittedBlockHeight !== undefined) {
          updateData.transaction_submitted_block_height = submittedBlockHeight;
        }

        await this.submissionsRepository.updateBySha256Hash(sha256Hash, updateData);

        logger.debug(
          { sha256Hash, transactionHash: pendingTxn.hash, submittedBlockHeight },
          'Transaction ID and block height saved to database'
        );
      }

      // Wait for confirmation (optional)
      if (pendingTxn.wait) {
        logger.debug('Waiting for transaction confirmation...');
        await pendingTxn.wait();
        logger.info('Transaction confirmed on blockchain');
      }

      return pendingTxn.hash;
    } catch (error) {
      logger.error({ err: error }, 'Failed to publish proof');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw Errors.internal(`Failed to publish proof: ${errorMessage}`);
    }
  }

  /**
   * REVISED: Check if a specific zkApp is deployed
   */
  async isDeployed(zkAppAddress: string): Promise<boolean> {
    try {
      const zkAppPublicKey = PublicKey.fromBase58(zkAppAddress);
      logger.debug(`Checking zkApp deployment at ${zkAppAddress}`);

      await fetchAccount({ publicKey: zkAppPublicKey });
      const account = Mina.getAccount(zkAppPublicKey);
      logger.debug(
        {
          address: zkAppPublicKey.toBase58(),
          balance: account.balance.toString(),
          nonce: account.nonce.toString(),
          hasZkapp: !!account.zkapp,
          zkappState: account.zkapp?.appState?.map((s) => s.toString()),
        },
        'Account fetched'
      );

      return !!account.zkapp;
    } catch (error) {
      logger.error({ err: error }, 'Error checking deployment');
      return false;
    }
  }
}
```

### 8.2 Update ProofGenerationJobData Interface

**File**: `src/services/queue/jobQueue.service.ts`

```typescript
export interface ProofGenerationJobData {
  sha256Hash: string;
  signature: string;
  storageKey: string;
  tokenOwnerAddress: string;
  tokenOwnerPrivateKey: string;
  zkAppAddress: string; // NEW: zkApp address for this proof
  uploadedAt: Date;
  priority?: number;
  correlationId?: string;
}
```

### 8.3 Update Proof Worker Entry Point

**File**: `src/startProofWorker.ts`

```typescript
// REVISED: Remove zkAppAddress from constructor
const proofPublishingService = new ProofPublishingService(
  config.feePayerPrivateKey,
  config.minaNetwork,
  submissionsRepository,
  minaNodeService
  // Removed: config.zkappAddress - now passed per-proof
);
```

### 8.4 Update ProofGenerationWorker

**File**: `src/workers/proofGenerationWorker.ts`

```typescript
// Inside the job processing loop:
const {
  sha256Hash,
  signature,
  storageKey,
  tokenOwnerAddress: _tokenOwnerAddress,
  tokenOwnerPrivateKey,
  zkAppAddress, // NEW: Extract from job data
} = job.data;

// ... proof generation logic ...

// REVISED: Pass zkAppAddress to publishProof
const transactionId = await this.proofPublishingService.publishProof(
  sha256Hash,
  proof,
  publicInputs,
  tokenOwnerPrivateKey,
  zkAppAddress // NEW: Pass zkApp address
);
```

---

## 9. Package.json Scripts

**File**: `package.json`

```json
{
  "scripts": {
    "dev:api": "tsx watch src/index.ts",
    "dev:worker": "tsx watch src/startProofWorker.ts",
    "dev:monitoring": "tsx watch src/startMonitoringWorker.ts",
    "dev:deployment": "tsx watch src/startContractDeploymentWorker.ts",

    "start:api": "npm run db:migrate && npm run compile:zkapp && tsx src/index.ts",
    "start:worker": "npm run compile:zkapp && tsx src/startProofWorker.ts",
    "start:monitoring": "tsx src/startMonitoringWorker.ts",
    "start:deployment": "npm run compile:zkapp && tsx src/startContractDeploymentWorker.ts"
  }
}
```

---

## 10. Railway Deployment Configuration

### 10.1 Add New Service

**Service Name**: `contract-deployment-worker`

**Start Command**: `npm run start:deployment`

**Environment Variables**:
- All existing variables (DATABASE_URL, MINA_NETWORK, FEE_PAYER_PRIVATE_KEY, etc.)

**Resource Allocation**:
- Memory: 2GB (needed for contract compilation)
- Replicas: 1 (multiple replicas supported due to singletonKey, but 1 is sufficient)

---

## 11. Testing Strategy (REVISED)

### 11.1 Unit Tests

**File**: `test/services/contractDeployment.service.test.ts`

Focus on **behavior**, not implementation details:

```typescript
describe('ContractDeploymentService', () => {
  // ✅ Test behavior
  it('should successfully deploy contract with valid inputs', async () => {
    // Mock Mina.transaction, PrivateKey, etc.
    const result = await service.deployContract('challenge-123');
    expect(result.success).toBe(true);
    expect(result.zkAppAddress).toBeDefined();
    expect(result.txHash).toBeDefined();
  });

  // ✅ Test error handling
  it('should return error when fee payer has insufficient balance', async () => {
    // Mock transaction to throw insufficient balance error
    const result = await service.deployContract('challenge-456');
    expect(result.success).toBe(false);
    expect(result.error).toContain('insufficient balance');
  });

  // ✅ Test error handling
  it('should handle network timeout during deployment', async () => {
    // Mock transaction to timeout
    const result = await service.deployContract('challenge-789');
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  // ❌ REMOVED: Don't test implementation details
  // it('should call BatchReducerUtils.compile() with actual instance')
});
```

**File**: `test/workers/contractDeploymentWorker.test.ts`

```typescript
describe('ContractDeploymentWorker', () => {
  // ✅ Test job processing flow
  it('should process deployment job and update challenge status', async () => {
    // Mock deployment service, repository
    await worker.processJob(mockJob);
    expect(challengesRepo.update).toHaveBeenCalledWith('challenge-123', {
      deployment_status: 'active',
      zkapp_address: expect.any(String),
    });
  });

  // ✅ Test retry logic
  it('should retry failed deployment up to 3 times', async () => {
    // Mock deployment to fail twice, succeed on third
    // Verify retry behavior
  });

  // ✅ Test terminal failure
  it('should mark deployment as failed after max retries', async () => {
    // Mock deployment to fail all 3 times
    expect(challengesRepo.update).toHaveBeenCalledWith('challenge-123', {
      deployment_status: 'deployment_failed',
      deployment_failure_reason: expect.any(String),
    });
  });
});
```

**File**: `test/handlers/challenges.handler.test.ts`

```typescript
describe('ChallengesHandler', () => {
  // ✅ Test job enqueueing
  it('should enqueue deployment job when creating challenge', async () => {
    await handler.createChallenge(req, res, next);
    expect(jobQueue.enqueueContractDeployment).toHaveBeenCalledWith({
      challengeId: expect.any(String),
      correlationId: expect.any(String),
    });
  });

  // ✅ Test response includes deployment fields
  it('should return challenge with pending_deployment status', async () => {
    await handler.createChallenge(req, res, next);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentStatus: 'pending_deployment',
        zkAppAddress: undefined,
      })
    );
  });
});
```

**File**: `test/services/proofPublishing.service.test.ts` (NEW TESTS)

```typescript
describe('ProofPublishingService', () => {
  // ✅ Test stateless behavior
  it('should publish proof to specified zkApp address', async () => {
    const zkAppAddress1 = 'B62q...challenge1';
    const zkAppAddress2 = 'B62q...challenge2';

    // Same service instance can publish to different zkApps
    await service.publishProof(hash1, proof1, inputs1, tokenKey1, zkAppAddress1);
    await service.publishProof(hash2, proof2, inputs2, tokenKey2, zkAppAddress2);

    // Verify transactions went to correct addresses
  });

  // ✅ Test error when zkApp not deployed
  it('should throw error if zkApp address is not deployed', async () => {
    const undeployedAddress = 'B62q...undeployed';
    await expect(
      service.publishProof(hash, proof, inputs, tokenKey, undeployedAddress)
    ).rejects.toThrow('not deployed');
  });
});
```

### 11.2 Integration Tests (SIMPLIFIED)

**File**: `test/integration/challenges.integration.test.ts`

```typescript
describe('Challenge Deployment Flow', () => {
  // ✅ Test API contract - deployment fields present
  it('should create challenge with pending_deployment status', async () => {
    const res = await request(API_URL)
      .post('/api/challenges')
      .auth(ADMIN_USERNAME, ADMIN_PASSWORD)
      .send({
        title: 'Integration Test Challenge',
        description: 'Testing deployment',
        startTime: getRelativeDate(1),
        endTime: getRelativeDate(10),
      });

    expect(res.status).toBe(201);
    expect(res.body.deploymentStatus).toBe('pending_deployment');
    expect(res.body.zkAppAddress).toBeUndefined();
    expect(res.body.deploymentRetryCount).toBe(0);
  });

  // ✅ Test business logic - submission validation
  it('should reject submission for challenge with pending deployment', async () => {
    // Create challenge (will be pending_deployment)
    const challenge = await createTestChallenge({ startDaysFromNow: 1, endDaysFromNow: 10 });

    // Try to submit (should fail)
    const res = await request(API_URL)
      .post('/api/submissions')
      .attach('image', TEST_IMAGE_PATH)
      .field('chainId', challenge.chainId)
      .field('walletAddress', TEST_WALLET)
      .field('signatureR', VALID_SIG_R)
      .field('signatureS', VALID_SIG_S);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('not yet ready for submissions');
  });
});
```

**CRITICAL: Update Existing Submission Tests**

All existing submission integration tests must be updated:

```typescript
// test/integration/utils/test-helpers.ts
async function createDeployedTestChallenge(options) {
  const challengeId = await createTestChallenge(options);

  // Set deployment status to active for testing
  await db.raw(`
    UPDATE challenges
    SET deployment_status = 'active',
        zkapp_address = ?
    WHERE id = ?
  `, [config.zkappAddress, challengeId]); // Use legacy zkApp for tests

  return challengeId;
}

// Use createDeployedTestChallenge() in all submission tests
```

---

## 12. Error Handling & Edge Cases

### 12.1 Deployment Failures

**Scenario**: Fee payer has insufficient balance
- **Handling**: Worker catches error, updates failure reason, retries up to 3 times
- **Admin Action**: Add funds to fee payer account

**Scenario**: Network timeout during deployment
- **Handling**: pg-boss retries with exponential backoff (2min, 4min, 8min)
- **Terminal State**: After 3 failures, status becomes `deployment_failed`

### 12.2 Duplicate Job Prevention

**Implementation**: Use `singletonKey: challengeId` in pg-boss
- Prevents multiple deployment jobs for the same challenge

### 12.3 Challenge Start Time Before Deployment Completion

**Recommended Admin Workflow**:
- Set challenge start time at least 5 minutes in the future
- Admin dashboard should warn if start time < 5 minutes from now

**If deployment fails after start time**:
- Challenge remains in `deployment_failed` state
- Admin deletes failed challenge and creates new one

### 12.4 Submission Before Deployment Completion

**Validation at submission creation**:
- `createSubmission()` checks `challenge.deployment_status === 'active'`
- Returns HTTP 400 with clear message

**Fallback at admin review**:
- `reviewSubmission()` double-checks deployment status before proof generation
- Prevents race conditions

### 12.5 Private Key Management

**Security Design**:
- zkApp private keys generated randomly and **never stored**
- Used only to sign deployment transaction
- Discarded after transaction sent

**Trade-offs**:
- ✅ No risk of key leakage
- ✅ No encryption overhead
- ❌ Cannot upgrade contracts later (would need private key)
- Solution: Deploy new zkApp for upgrades

---

## 13. Migration Path

### 13.1 Backward Compatibility

**Phase 1: Deploy Changes**
- Deploy database migration
- Deploy updated API and workers
- Keep `ZKAPP_ADDRESS` env var for backward compatibility

**Phase 2: Migrate Existing Challenges**

**File**: `scripts/migrate-existing-challenges.ts`

```typescript
import { config } from '../src/config/index.js';
import { DatabaseConnection } from '../src/db/database.js';

async function migrateExistingChallenges() {
  const db = new DatabaseConnection({ connectionString: config.databaseUrl });
  await db.initialize();

  const knex = db.getAdapter().getKnex();

  // Update all existing challenges to use legacy zkApp address
  const updated = await knex('challenges')
    .whereNull('zkapp_address')
    .update({
      zkapp_address: config.zkappAddress, // Legacy env var
      deployment_status: 'active',
      deployment_completed_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });

  console.log(`Migrated ${updated} existing challenges to use legacy zkApp address`);

  await db.close();
}

migrateExistingChallenges();
```

**Phase 3: Remove Legacy Support** (future)
- Remove `ZKAPP_ADDRESS` env var
- All challenges require their own deployed zkApp

---

## 14. Implementation Checklist

### Database
- [ ] Create migration for zkApp fields (without deployment_block_height)
- [ ] Update Challenge type definition
- [ ] Add update() method to ChallengesRepository

### Job Queue
- [ ] Add ContractDeploymentJobData interface (simplified)
- [ ] Add enqueueContractDeployment() method
- [ ] Create contract-deployment queue
- [ ] Add priority support to job options

### Services
- [ ] Implement ContractDeploymentService
- [ ] Refactor ProofPublishingService to be stateless
- [ ] Update isDeployed() to accept zkAppAddress parameter

### Worker
- [ ] Create ContractDeploymentWorker (with teamConcurrency: 1)
- [ ] Add job processing logic with DB query for logging
- [ ] Create startContractDeploymentWorker.ts entry point

### Handlers
- [ ] Update ChallengesHandler to enqueue deployment job (simplified data)
- [ ] Update ChallengeResponse interface
- [ ] Update SubmissionsHandler.createSubmission() validation
- [ ] Update SubmissionsHandler.reviewSubmission() validation
- [ ] Pass zkAppAddress from challenge to proof generation job

### Proof Services
- [ ] Update ProofGenerationJobData to include zkAppAddress
- [ ] Update ProofGenerationWorker to pass zkAppAddress to publishProof()
- [ ] Update startProofWorker.ts constructor (remove zkAppAddress)

### Scripts
- [ ] Add dev:deployment npm script
- [ ] Add start:deployment npm script
- [ ] Create migrate-existing-challenges.ts script

### Railway Deployment
- [ ] Create contract-deployment-worker service
- [ ] Set resource allocation (2GB RAM)
- [ ] Verify 0.1 MINA deployment fee is adequate

### Testing
- [ ] Write behavioral unit tests for ContractDeploymentService
- [ ] Write unit tests for ContractDeploymentWorker (retry logic)
- [ ] Write unit tests for stateless ProofPublishingService
- [ ] Add integration tests for deployment validation
- [ ] **CRITICAL**: Update all submission tests to use deployed challenges

### Documentation
- [ ] Update CLAUDE.md with new worker commands
- [ ] Update Swagger API docs
- [ ] Document 0.1 MINA fee verification process

---

## 15. Estimated Implementation Time (REVISED)

| Task | Original | Revised | Reason |
|------|----------|---------|--------|
| Database migration + types | 1h | 0.75h | Removed block_height field |
| Job queue updates | 0.5h | 0.25h | Simplified job data |
| ContractDeploymentService | 2h | 2h | No change |
| ContractDeploymentWorker | 1.5h | 1.5h | No change |
| Handler updates | 2h | 1.5h | Simplified job data |
| Proof service refactoring | 1h | **3h** | Full stateless refactoring |
| Testing | 3h | 2.5h | Simplified test strategy |
| Railway deployment | 1h | 1h | No change |
| Documentation | 1h | 0.5h | Less complexity |
| **Total** | **13h** | **~13h** | More time on refactoring, less elsewhere |

---

## 16. Summary of Revisions

### Removed Complexity
- ❌ `deployment_block_height` field (never populated)
- ❌ `title` from job data (query DB when needed)
- ❌ `network` from job data (not used)
- ❌ Implementation detail tests (compile() calls)
- ❌ Redundant integration tests (schema validation)

### Added Robustness
- ✅ Stateless ProofPublishingService (supports multiple zkApps)
- ✅ Sequential deployment (teamConcurrency: 1, memory-intensive operations)
- ✅ Better test coverage for stateless service
- ✅ Clearer migration path for existing challenges

### Net Result
- **Same implementation time** (~13 hours)
- **Better architecture** (stateless service, reusable)
- **Less technical debt** (no unused fields, simpler tests)
- **More scalable** (multi-zkApp support, stateless services)

---

## Action Items Before Implementation

1. **Verify 0.1 MINA deployment fee** on testnet/devnet
   - Deploy test contract and check if fee is sufficient
   - Adjust if needed based on network conditions

2. **Review ProofPublishingService refactoring**
   - Ensure network setup in constructor is sufficient
   - Verify BatchReducerUtils per-proof compilation is acceptable

3. **Confirm concurrency limits**
   - teamConcurrency: 1 ensures single deployment at a time (memory-intensive)
   - Monitor and adjust based on actual memory usage

4. **Plan test database setup**
   - Existing submission tests will need deployed challenges
   - Create helper function for test setup
