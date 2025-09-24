# TouchGrass MVP Implementation Guide

This guide provides step-by-step instructions for implementing the database models and API routes required for the TouchGrass MVP. It's designed for developers new to the project and follows the existing patterns established in the codebase.

## Current Progress

**Phase 1: Database and Core Models**
- ✅ Created migration files for all tables (users, challenges, chains, submissions)
- ✅ Defined TypeScript types in `src/db/types/touchgrass.types.ts`
- ✅ Updated submission states: `pending` → `proving` → `awaiting_confirmation` → `verified` (or `failed`)
- ✅ Configured users table to use `wallet_address` as primary key
- ✅ Added public key verification for wallet addresses
- ⏳ Ready to run migrations and create repository layer

## Key Changes from Original Plan

### Architecture Simplifications:
1. **No separate service layer** - Handlers orchestrate repositories directly (like existing upload handler)
2. **Reuse existing worker** - Submissions use the same proof generation worker, just with different repository
3. **Single source of truth for status** - Status tracked in submissions table, no duplication
4. **Simplified timestamps** - Only created_at and updated_at (no separate timestamps for each status)
5. **Direct wallet address storage** - No separate users table, wallet_address stored in submissions

### Full Upload Flow Integration:
- Submissions endpoint accepts multipart form with image, publicKey, signature (like current upload)
- Validates signature using o1js
- Stores image in MinIO for worker access
- Creates submission record with all proof generation data
- Enqueues job for existing proof generation worker
- Worker processes identically to authenticity records

### Database Design:
- Submissions table contains all fields needed for proof generation
- No foreign key to authenticity_records (submissions replace them)
- Stores token_owner_private_key for blockchain publishing
- Simplified status tracking with only created_at and updated_at timestamps
- Status flow: pending → proving → awaiting_confirmation → verified (or failed)

## Error Handling Strategy

### Consistent Error Response Format

All endpoints return errors in this format (matching existing error.middleware.ts):

```typescript
interface ErrorResponse {
  error: {
    code: string;      // Machine-readable error code
    message: string;   // Human-readable error message
    field?: string;    // Optional field that caused the error
    details?: any;     // Optional additional details (dev mode only)
  };
}
```

### Standard HTTP Status Codes

```typescript
// Error codes and their corresponding HTTP status codes
const ERROR_CODES = {
  // 400 Bad Request - Client sent invalid data
  VALIDATION_ERROR: 400,      // Invalid input data
  INVALID_SIGNATURE: 400,      // Signature verification failed
  INVALID_IMAGE: 400,          // Image validation failed
  MISSING_FIELD: 400,          // Required field missing

  // 401 Unauthorized - Authentication required
  UNAUTHORIZED: 401,           // No authentication provided
  INVALID_TOKEN: 401,          // Invalid auth token

  // 403 Forbidden - Authenticated but not allowed
  FORBIDDEN: 403,              // No permission for this action

  // 404 Not Found - Resource doesn't exist
  NOT_FOUND: 404,              // Resource not found
  CHALLENGE_NOT_FOUND: 404,    // No active challenge
  SUBMISSION_NOT_FOUND: 404,   // Submission doesn't exist

  // 409 Conflict - Resource state conflict
  DUPLICATE_SUBMISSION: 409,   // User already submitted
  DUPLICATE_IMAGE: 409,        // Image already exists

  // 413 Payload Too Large
  FILE_TOO_LARGE: 413,         // Image exceeds size limit

  // 422 Unprocessable Entity - Business logic errors
  NO_ACTIVE_CHALLENGE: 422,   // No challenge is currently active
  CHALLENGE_ENDED: 422,        // Challenge has ended

  // 429 Too Many Requests
  RATE_LIMIT_EXCEEDED: 429,    // Too many requests from this IP/wallet

  // 500 Internal Server Error - Server issues
  INTERNAL_ERROR: 500,         // Generic server error
  DATABASE_ERROR: 500,         // Database operation failed
  STORAGE_ERROR: 500,          // MinIO operation failed
  BLOCKCHAIN_ERROR: 500,       // Mina interaction failed

  // 503 Service Unavailable
  SERVICE_UNAVAILABLE: 503,    // Service temporarily down
} as const;
```

### Error Handling Implementation

Create `src/utils/errors.ts`:

```typescript
export class ApiError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public field?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Predefined error creators for common scenarios
export const Errors = {
  // Validation errors
  validationError: (message: string, field?: string) =>
    new ApiError('VALIDATION_ERROR', 400, message, field),

  missingField: (field: string) =>
    new ApiError('MISSING_FIELD', 400, `${field} is required`, field),

  invalidSignature: (message = 'Signature verification failed') =>
    new ApiError('INVALID_SIGNATURE', 400, message, 'signature'),

  // Not found errors
  notFound: (resource: string) =>
    new ApiError('NOT_FOUND', 404, `${resource} not found`),

  challengeNotFound: () =>
    new ApiError('CHALLENGE_NOT_FOUND', 404, 'No active challenge found'),

  // Conflict errors
  duplicateSubmission: () =>
    new ApiError('DUPLICATE_SUBMISSION', 409, 'User has already submitted for this challenge'),

  duplicateImage: () =>
    new ApiError('DUPLICATE_IMAGE', 409, 'This image has already been submitted'),

  // Server errors
  internal: (message = 'An unexpected error occurred') =>
    new ApiError('INTERNAL_ERROR', 500, message),

  database: (message = 'Database operation failed') =>
    new ApiError('DATABASE_ERROR', 500, message),

  storage: (message = 'Storage operation failed') =>
    new ApiError('STORAGE_ERROR', 500, message),
};
```

### Error Middleware (Already Exists)

The existing `src/api/middleware/error.middleware.ts` handles all errors consistently:

```typescript
export function errorMiddleware(
  error: unknown,
  req: Request,
  res: Response<ErrorResponse>,
  _next: NextFunction
): void {
  // Log error with context
  logger.error({
    err: error,
    method: req.method,
    path: req.path,
    correlationId: (req as any).correlationId,
  }, 'Request error');

  // Handle ApiError instances
  if (error instanceof ApiError) {
    const response: ErrorResponse = {
      error: {
        code: error.code,
        message: error.message,
        field: error.field,
      }
    };

    // Add details in development
    if (config.NODE_ENV === 'development' && error.details) {
      response.error.details = error.details;
    }

    res.status(error.statusCode).json(response);
    return;
  }

  // Handle other errors...
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    }
  });
}
```

### Handler Error Usage

Example in handlers:

```typescript
import { Errors } from '../utils/errors.js';

export class SubmissionsHandler {
  async createSubmission(req: Request, res: Response): Promise<void> {
    try {
      const { walletAddress, tagline } = req.body;

      // Validation with proper errors
      if (!walletAddress) throw Errors.missingField('walletAddress');
      if (!req.file) throw Errors.missingField('image');

      // Check for duplicate
      const existing = await this.submissionsRepo.findBySha256Hash(sha256Hash);
      if (existing) throw Errors.duplicateImage();

      // Check active challenge
      const challenge = await this.challengesRepo.findCurrent();
      if (!challenge) throw Errors.challengeNotFound();

      // Check if user already submitted
      const userSubmission = await this.submissionsRepo.findByWalletAndChallenge(
        walletAddress,
        challenge.id
      );
      if (userSubmission) throw Errors.duplicateSubmission();

      // ... rest of logic
    } catch (error) {
      // Error middleware handles it
      next(error);
    }
  }
}
```

### Validation Helpers

Create `src/utils/validation.ts`:

```typescript
import { PublicKey, Signature } from 'o1js';
import { Errors } from './errors.js';

export const Validators = {
  sha256Hash: (hash: string): boolean =>
    /^[a-fA-F0-9]{64}$/.test(hash),

  walletAddress: (address: string): boolean => {
    try {
      // Mina wallet addresses are base58 encoded public keys
      PublicKey.fromBase58(address);
      return true;
    } catch {
      return false;
    }
  },

  publicKey: (key: string): boolean => {
    try {
      PublicKey.fromBase58(key);
      return true;
    } catch {
      return false;
    }
  },

  signature: (sig: string): boolean => {
    try {
      Signature.fromBase58(sig);
      return true;
    } catch {
      return false;
    }
  },

  uuid: (id: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),

  /**
   * Verify that a public key matches a wallet address
   * In Mina, the wallet address IS the public key in base58
   */
  publicKeyMatchesWallet: (publicKey: string, walletAddress: string): boolean => {
    try {
      const pk = PublicKey.fromBase58(publicKey);
      const wallet = PublicKey.fromBase58(walletAddress);

      // In Mina, they should be exactly the same
      return pk.toBase58() === wallet.toBase58();
    } catch {
      return false;
    }
  },
};

// Validation middleware
export function validate(field: string, validator: (value: any) => boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[field] || req.body[field] || req.query[field];
    if (!value || !validator(value)) {
      throw Errors.validationError(`Invalid ${field} format`, field);
    }
    next();
  };
}

// Middleware to validate public key matches wallet address
export function validateKeyMatchesWallet(req: Request, res: Response, next: NextFunction) {
  const { publicKey, walletAddress } = req.body;

  if (publicKey && walletAddress) {
    if (!Validators.publicKeyMatchesWallet(publicKey, walletAddress)) {
      throw new ApiError(
        'KEY_WALLET_MISMATCH',
        400,
        'Public key does not match wallet address',
        'publicKey'
      );
    }
  }

  next();
}
```

## Table of Contents

1. [Database Models Implementation](#1-database-models-implementation)
2. [Repository Layer Implementation](#2-repository-layer-implementation)
3. [Service Layer Implementation](#3-service-layer-implementation)
4. [Handler Layer Implementation](#4-handler-layer-implementation)
5. [Routes Implementation](#5-routes-implementation)
6. [Unit Testing](#6-unit-testing)
7. [Integration Testing](#7-integration-testing)
8. [Admin Functionality](#8-admin-functionality)

## Prerequisites

- Ensure Docker is running with PostgreSQL: `docker-compose up -d`
- Install dependencies: `npm install`
- Set up environment variables: `cp .env.example .env`

## 1. Database Models Implementation

### Step 1.1: Create Database Migration Files

Create new migration files for each model. The project uses Knex for migrations.

```bash
npx knex migrate:make create_users_table
npx knex migrate:make create_challenges_table
npx knex migrate:make create_chains_table
npx knex migrate:make create_submissions_table
```

### Step 1.2: Implement Users Table Migration

Create `migrations/[timestamp]_create_users_table.ts`:

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    // Wallet address is the primary key - it's unique and we verify ownership via signature
    table.string('wallet_address', 255).primary();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Index for performance
    table.index('created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
```

### Step 1.3: Implement Challenges Table Migration

Create `migrations/[timestamp]_create_challenges_table.ts`:

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('challenges', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('title', 255).notNullable();
    table.text('description').notNullable();
    table.timestamp('start_time').notNullable();
    table.timestamp('end_time').notNullable();
    table.integer('participant_count').notNullable().defaultTo(0);
    table.integer('chain_count').notNullable().defaultTo(1); // Always 1 for MVP
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Indexes for performance
    table.index('start_time');
    table.index('end_time');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('challenges');
}
```

### Step 1.4: Implement Chains Table Migration

Create `migrations/[timestamp]_create_chains_table.ts`:

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('chains', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 255).notNullable().defaultTo('Default');
    table.uuid('challenge_id').notNullable();
    table.integer('length').notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_activity_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Foreign key
    table.foreign('challenge_id').references('id').inTable('challenges').onDelete('CASCADE');

    // Indexes
    table.index('challenge_id');
    table.index('last_activity_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('chains');
}
```

### Step 1.5: Implement Submissions Table Migration (Simplified)

Create `migrations/[timestamp]_create_submissions_table.ts`:

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('submissions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('sha256_hash', 64).notNullable().unique();
    table.string('wallet_address', 255).notNullable(); // Foreign key to users
    table.string('token_owner_address', 255).notNullable();
    table.string('token_owner_private_key', 255).nullable();
    table.string('public_key', 255).notNullable(); // Must match wallet_address
    table.string('signature', 500).notNullable();
    table.uuid('challenge_id').notNullable();
    table.uuid('chain_id').notNullable();
    table.string('storage_key', 255).nullable();
    table.string('tagline', 255).nullable();
    table.integer('chain_position').notNullable();
    table
      .enum('status', ['pending', 'proving', 'awaiting_confirmation', 'verified', 'failed'])
      .notNullable()
      .defaultTo('pending');
    table.string('transaction_id', 255).nullable();
    table.text('failure_reason').nullable();
    table.integer('retry_count').notNullable().defaultTo(0);
    table.boolean('challenge_verified').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Foreign keys
    table.foreign('wallet_address').references('wallet_address').inTable('users').onDelete('CASCADE');
    table.foreign('challenge_id').references('id').inTable('challenges').onDelete('CASCADE');
    table.foreign('chain_id').references('id').inTable('chains').onDelete('CASCADE');

    // Indexes
    table.index('wallet_address');
    table.index('challenge_id');
    table.index('chain_id');
    table.index('sha256_hash');
    table.index('status');
    table.index('created_at'); // For ordering

    // Unique constraint: one submission per wallet per challenge
    table.unique(['wallet_address', 'challenge_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('submissions');
}
```

### Step 1.6: Define TypeScript Types

Create `src/db/types/touchgrass.types.ts`:

**Important Type Organization**:
- **Database Models Only**: This file contains only the database table interfaces with snake_case properties
- **Response Types**: Define these in handler files (e.g., `UserResponse` in `users.handler.ts`)
- **Input Types**: Define these in repository or handler files (e.g., `CreateUserInput` in `users.repository.ts`)
- **Job Queue Types**: Define these in job queue service or worker files (e.g., `ProofGenerationJobData` in worker)
- **Query Types**: Define these in repository files (e.g., `SubmissionQuery` in `submissions.repository.ts`)

```typescript
// Database Models (snake_case - matches database)
export interface User {
  wallet_address: string; // Primary key
  created_at: string;
  updated_at: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  participant_count: number;
  chain_count: number;
  created_at: string;
  updated_at: string;
}

export interface Chain {
  id: string;
  name: string;
  challenge_id: string;
  length: number;
  created_at: string;
  last_activity_at: string;
  updated_at: string;
}

export interface Submission {
  id: string;
  sha256_hash: string;
  wallet_address: string; // Foreign key to users.wallet_address
  token_owner_address: string;
  token_owner_private_key?: string | null;
  public_key: string; // Must cryptographically match wallet_address
  signature: string;
  challenge_id: string;
  chain_id: string;
  storage_key?: string | null;
  tagline?: string | null;
  chain_position: number;
  status: 'pending' | 'proving' | 'awaiting_confirmation' | 'verified' | 'failed';
  transaction_id?: string | null;
  failure_reason?: string | null;
  retry_count: number;
  challenge_verified: boolean;
  created_at: string;
  updated_at: string;
}

// API Response Types (camelCase)
export interface UserResponse {
  walletAddress: string;
  createdAt: Date;
}

export interface ChallengeResponse {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  participantCount: number;
  chainCount: number;
}

export interface ChainResponse {
  id: string;
  name: string;
  challengeId: string;
  length: number;
  createdAt: Date;
  lastActivityAt: Date;
}

export interface SubmissionResponse {
  id: string;
  sha256Hash: string;
  tokenOwnerAddress: string;
  walletAddress: string;
  challengeId: string;
  chainId: string;
  imageUrl?: string;
  tagline?: string;
  chainPosition: number;
  status: 'pending' | 'proving' | 'awaiting_confirmation' | 'verified' | 'failed';
  transactionId?: string;
  createdAt: Date;
}

// Input Types
export interface CreateUserInput {
  walletAddress: string;
}

export interface CreateSubmissionInput {
  sha256Hash: string;
  tokenOwnerAddress: string;
  tokenOwnerPrivateKey: string;
  walletAddress: string; // References users.wallet_address
  publicKey: string; // Must match walletAddress
  signature: string;
  challengeId: string;
  chainId: string;
  storageKey: string;
  tagline?: string;
  chainPosition: number;
}

export interface ProofGenerationJobData {
  submissionId: string;
  sha256Hash: string;
  signature: string;
  publicKey: string;
  storageKey: string;
  tokenOwnerAddress: string;
  tokenOwnerPrivateKey: string;
  uploadedAt: Date;
  correlationId?: string;
}

export interface SubmissionQuery {
  walletAddress?: string;
  challengeId?: string;
  chainId?: string;
  page?: number;
  limit?: number;
}
```

### Step 1.7: Run Migrations

```bash
npm run db:migrate
```

## 2. Repository Layer Implementation

### Step 2.1: Create Users Repository

Create `src/db/repositories/users.repository.ts`:

```typescript
import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { User, CreateUserInput, UserResponse } from '../types/touchgrass.types.js';
import { PublicKey } from 'o1js';

export class UsersRepository {
  constructor(private readonly db: PostgresAdapter) {}

  async findByWalletAddress(walletAddress: string): Promise<User | null> {
    const result = await this.db
      .getKnex()('users')
      .where('wallet_address', walletAddress)
      .first();

    return result || null;
  }

  async create(input: CreateUserInput): Promise<User> {
    // Validate wallet address is a valid Mina public key
    try {
      PublicKey.fromBase58(input.walletAddress);
    } catch {
      throw new Error('Invalid wallet address format');
    }

    const [user] = await this.db
      .getKnex()('users')
      .insert({
        wallet_address: input.walletAddress,
      })
      .returning('*');

    return user;
  }

  async findOrCreate(walletAddress: string): Promise<User> {
    const existing = await this.findByWalletAddress(walletAddress);
    if (existing) return existing;

    return this.create({ walletAddress });
  }
}
```

### Step 2.2: Create Challenges Repository

Create `src/db/repositories/challenges.repository.ts`:

```typescript
import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { Challenge, ChallengeResponse } from '../types/touchgrass.types.js';

export class ChallengesRepository {
  constructor(private readonly db: PostgresAdapter) {}

  async findCurrent(): Promise<Challenge | null> {
    const now = new Date();
    const result = await this.db
      .getKnex()('challenges')
      .where('start_time', '<=', now)
      .where('end_time', '>', now)
      .orderBy('start_time', 'desc')
      .first();

    return result || null;
  }

  async findById(id: string): Promise<Challenge | null> {
    const result = await this.db
      .getKnex()('challenges')
      .where('id', id)
      .first();

    return result || null;
  }

  async findAll(): Promise<Challenge[]> {
    return this.db
      .getKnex()('challenges')
      .orderBy('start_time', 'desc');
  }

  async incrementParticipantCount(id: string): Promise<void> {
    await this.db
      .getKnex()('challenges')
      .where('id', id)
      .increment('participant_count', 1);
  }

  toResponse(challenge: Challenge): ChallengeResponse {
    return {
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      startTime: new Date(challenge.start_time),
      endTime: new Date(challenge.end_time),
      participantCount: challenge.participant_count,
      chainCount: challenge.chain_count,
    };
  }
}
```

### Step 2.3: Create Chains Repository

Create `src/db/repositories/chains.repository.ts`:

```typescript
import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { Chain, ChainResponse } from '../types/touchgrass.types.js';
import { Knex } from 'knex';

export class ChainsRepository {
  constructor(private readonly db: PostgresAdapter) {}

  async findById(id: string): Promise<Chain | null> {
    const result = await this.db
      .getKnex()('chains')
      .where('id', id)
      .first();

    return result || null;
  }

  async findByChallengeId(challengeId: string): Promise<Chain[]> {
    return this.db
      .getKnex()('chains')
      .where('challenge_id', challengeId)
      .orderBy('created_at', 'asc');
  }

  async create(challengeId: string, name: string = 'Default'): Promise<Chain> {
    const [chain] = await this.db
      .getKnex()('chains')
      .insert({
        challenge_id: challengeId,
        name,
        length: 0,
      })
      .returning('*');

    return chain;
  }

  async incrementLength(id: string, trx?: Knex.Transaction): Promise<void> {
    const query = trx || this.db.getKnex();
    await query('chains')
      .where('id', id)
      .increment('length', 1)
      .update('last_activity_at', query.fn.now());
  }

  async findOrCreateForChallenge(challengeId: string): Promise<Chain> {
    const chains = await this.findByChallengeId(challengeId);
    if (chains.length > 0) return chains[0]; // MVP: return first chain

    return this.create(challengeId);
  }

  toResponse(chain: Chain): ChainResponse {
    return {
      id: chain.id,
      name: chain.name,
      challengeId: chain.challenge_id,
      length: chain.length,
      createdAt: new Date(chain.created_at),
      lastActivityAt: new Date(chain.last_activity_at),
    };
  }
}
```

### Step 2.4: Create Submissions Repository

Create `src/db/repositories/submissions.repository.ts`:

```typescript
import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { Submission, CreateSubmissionInput, SubmissionResponse, SubmissionQuery } from '../types/touchgrass.types.js';
import { Knex } from 'knex';

export class SubmissionsRepository {
  constructor(private readonly db: PostgresAdapter) {}

  async findById(id: string): Promise<Submission | null> {
    const result = await this.db
      .getKnex()('submissions')
      .where('id', id)
      .first();

    return result || null;
  }

  async findBySha256Hash(sha256Hash: string): Promise<Submission | null> {
    const result = await this.db
      .getKnex()('submissions')
      .where('sha256_hash', sha256Hash)
      .first();

    return result || null;
  }

  async findByUserAndChallenge(userId: string, challengeId: string): Promise<Submission | null> {
    const result = await this.db
      .getKnex()('submissions')
      .where('user_id', userId)
      .where('challenge_id', challengeId)
      .first();

    return result || null;
  }

  async findWithQuery(query: SubmissionQuery): Promise<{ submissions: Submission[]; total: number }> {
    const knex = this.db.getKnex();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    let baseQuery = knex('submissions').select('submissions.*');
    let countQuery = knex('submissions');

    // Join with users table if filtering by wallet address
    if (query.walletAddress) {
      baseQuery = baseQuery
        .join('users', 'submissions.user_id', 'users.id')
        .where('users.wallet_address', query.walletAddress);

      countQuery = countQuery
        .join('users', 'submissions.user_id', 'users.id')
        .where('users.wallet_address', query.walletAddress);
    }

    if (query.challengeId) {
      baseQuery = baseQuery.where('submissions.challenge_id', query.challengeId);
      countQuery = countQuery.where('submissions.challenge_id', query.challengeId);
    }

    if (query.chainId) {
      baseQuery = baseQuery.where('submissions.chain_id', query.chainId);
      countQuery = countQuery.where('submissions.chain_id', query.chainId);
    }

    // Get paginated results
    const submissions = await baseQuery
      .orderBy('submissions.chain_position', 'asc')
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await countQuery.count('* as count');

    return {
      submissions,
      total: Number(count),
    };
  }

  async create(input: CreateSubmissionInput, trx?: Knex.Transaction): Promise<Submission> {
    const query = trx || this.db.getKnex();

    const [submission] = await query('submissions')
      .insert({
        sha256_hash: input.sha256Hash,
        token_owner_address: input.tokenOwnerAddress,
        token_owner_private_key: input.tokenOwnerPrivateKey,
        user_id: input.userId,
        public_key: input.publicKey,
        signature: input.signature,
        challenge_id: input.challengeId,
        chain_id: input.chainId,
        storage_key: input.storageKey,
        tagline: input.tagline,
        chain_position: input.chainPosition,
        status: 'pending',
      })
      .returning('*');

    return submission;
  }

  async updateJobId(id: string, jobId: string): Promise<void> {
    await this.db
      .getKnex()('submissions')
      .where('id', id)
      .update({
        job_id: jobId,
        updated_at: this.db.getKnex().fn.now(),
      });
  }

  async updateStatus(
    sha256Hash: string,
    status: Submission['status'],
    extras?: {
      transaction_id?: string | null;
      failure_reason?: string | null;
      retry_count?: number;
    }
  ): Promise<void> {
    await this.db
      .getKnex()('submissions')
      .where('sha256_hash', sha256Hash)
      .update({
        status,
        ...extras,
        updated_at: this.db.getKnex().fn.now(),
      });
  }

  async updateChallengeVerified(id: string, verified: boolean): Promise<void> {
    await this.db
      .getKnex()('submissions')
      .where('id', id)
      .update({
        challenge_verified: verified,
        updated_at: this.db.getKnex().fn.now(),
      });
  }

  toResponse(submission: Submission): SubmissionResponse {
    return {
      id: submission.id,
      sha256Hash: submission.sha256_hash,
      tokenOwnerAddress: submission.token_owner_address,
      walletAddress: submission.user_id, // This needs to be joined with users table
      challengeId: submission.challenge_id,
      chainId: submission.chain_id,
      imageUrl: submission.storage_key ? `/images/${submission.sha256_hash}` : undefined,
      tagline: submission.tagline || undefined,
      chainPosition: submission.chain_position,
      status: submission.status,
      transactionId: submission.transaction_id || undefined,
      createdAt: new Date(submission.created_at),
    };
  }
}
```

## 3. Service Layer Implementation

### Step 3.1: No Separate Service Needed

Since we're incorporating the full upload flow directly into the handler (like the existing upload handler), we don't need a separate submission service. The handler will orchestrate the repositories and services directly.

The existing services we'll reuse:
- `ImageAuthenticityService` - For image hashing and signature verification
- `MinioStorageService` - For storing images
- `JobQueueService` - For enqueueing proof generation jobs

## 4. Handler Layer Implementation

### Step 4.1: Create Submissions Handler with Full Upload Flow

Create `src/handlers/submissions.handler.ts`:

```typescript
import { Request, Response } from 'express';
import type {} from 'multer';
import { Signature, PublicKey, PrivateKey } from 'o1js';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { UsersRepository } from '../db/repositories/users.repository.js';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import { ChainsRepository } from '../db/repositories/chains.repository.js';
import { ImageAuthenticityService } from '../services/image/verification.service.js';
import { MinioStorageService } from '../services/storage/storageService.js';
import { JobQueueService } from '../services/queue/jobQueue.service.js';
import { PostgresAdapter } from '../db/adapters/PostgresAdapter.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';

export class SubmissionsHandler {
  constructor(
    private readonly submissionsRepo: SubmissionsRepository,
    private readonly usersRepo: UsersRepository,
    private readonly challengesRepo: ChallengesRepository,
    private readonly chainsRepo: ChainsRepository,
    private readonly verificationService: ImageAuthenticityService,
    private readonly storageService: MinioStorageService,
    private readonly jobQueue: JobQueueService,
    private readonly db: PostgresAdapter
  ) {}

  private validateSubmissionRequest(
    file: Express.Multer.File | undefined,
    publicKey: string | undefined,
    signature: string | undefined,
    walletAddress: string | undefined
  ): { isValid: boolean; error?: any; imageBuffer?: Buffer } {
    // Check required fields
    if (!file) {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No image file provided',
          field: 'image',
        },
      };
    }

    if (!publicKey) {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Public key is required',
          field: 'publicKey',
        },
      };
    }

    if (!signature) {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Signature is required',
          field: 'signature',
        },
      };
    }

    if (!walletAddress) {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Wallet address is required',
          field: 'walletAddress',
        },
      };
    }

    // Read and validate image buffer
    const imageBuffer = fs.readFileSync(file.path);
    if (!imageBuffer || imageBuffer.length === 0) {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Image buffer is empty',
          field: 'image',
        },
      };
    }

    // Validate public key format
    try {
      PublicKey.fromBase58(publicKey);
    } catch {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid public key format',
          field: 'publicKey',
        },
      };
    }

    // Validate signature format
    try {
      Signature.fromBase58(signature);
    } catch {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid signature format',
          field: 'signature',
        },
      };
    }

    return {
      isValid: true,
      imageBuffer,
    };
  }

  async createSubmission(req: Request, res: Response): Promise<void> {
    const file = req.file;
    let storageKey: string | undefined;

    try {
      const { publicKey, signature, walletAddress, tagline } = req.body;

      // Validate request
      const validation = this.validateSubmissionRequest(file, publicKey, signature, walletAddress);
      if (!validation.isValid) {
        res.status(400).json({ error: validation.error });
        if (file) fs.unlinkSync(file.path);
        return;
      }

      // Verify public key matches wallet address
      if (!Validators.publicKeyMatchesWallet(publicKey, walletAddress)) {
        res.status(400).json({
          error: {
            code: 'KEY_WALLET_MISMATCH',
            message: 'Public key does not match wallet address',
            field: 'publicKey'
          }
        });
        if (file) fs.unlinkSync(file.path);
        return;
      }

      const imageBuffer = validation.imageBuffer!;

      // Compute SHA256 hash
      const sha256Hash = this.verificationService.hashImage(imageBuffer);
      logger.debug({ sha256Hash }, 'Image hash calculated');

      // Check for duplicate image
      const existingSubmission = await this.submissionsRepo.findBySha256Hash(sha256Hash);
      if (existingSubmission) {
        logger.info('Duplicate image detected');
        fs.unlinkSync(file!.path);
        res.json({
          submission: this.submissionsRepo.toResponse(existingSubmission),
          status: 'duplicate',
        });
        return;
      }

      // Verify signature
      const verificationResult = this.verificationService.verifyAndPrepareImage(
        file!.path,
        signature,
        publicKey
      );

      if (!verificationResult.isValid) {
        logger.warn({ error: verificationResult.error }, 'Invalid signature');
        res.status(400).json({
          error: {
            code: 'INVALID_SIGNATURE',
            message: verificationResult.error || 'Signature verification failed',
          },
        });
        fs.unlinkSync(file!.path);
        return;
      }

      // Use transaction for creating submission
      const submission = await this.db.getKnex().transaction(async (trx) => {
        // Find or create user
        const user = await this.usersRepo.findOrCreate(walletAddress);

        // Get current challenge
        const currentChallenge = await this.challengesRepo.findCurrent();
        if (!currentChallenge) {
          throw new Error('No active challenge found');
        }

        // Check if user already submitted for this challenge
        const existingUserSubmission = await this.submissionsRepo.findByUserAndChallenge(
          user.id,
          currentChallenge.id
        );
        if (existingUserSubmission) {
          throw new Error('User has already submitted for this challenge');
        }

        // Find or create chain
        const chain = await this.chainsRepo.findOrCreateForChallenge(currentChallenge.id);

        // Generate token owner keypair
        const tokenOwnerKey = PrivateKey.random();
        const tokenOwnerAddress = tokenOwnerKey.toPublicKey().toBase58();
        const tokenOwnerPrivateKey = tokenOwnerKey.toBase58();

        // Upload to MinIO
        storageKey = await this.storageService.uploadImage(sha256Hash, imageBuffer);
        logger.debug({ storageKey, sha256Hash }, 'Image uploaded to MinIO');

        // Get chain position (use current length + 1)
        const chainPosition = chain.length + 1;

        // Create submission
        const submission = await this.submissionsRepo.create(
          {
            sha256Hash,
            tokenOwnerAddress,
            tokenOwnerPrivateKey,
            userId: user.id,
            publicKey,
            signature,
            challengeId: currentChallenge.id,
            chainId: chain.id,
            storageKey,
            tagline,
            chainPosition,
          },
          trx
        );

        // Increment chain length
        await this.chainsRepo.incrementLength(chain.id, trx);

        // Increment participant count if first submission by user to any challenge
        // (simplified for MVP - just increment on each submission)
        await this.challengesRepo.incrementParticipantCount(currentChallenge.id);

        return submission;
      });

      // Clean up temp file
      fs.unlinkSync(file!.path);

      // Enqueue proof generation job
      try {
        const jobId = await this.jobQueue.enqueueProofGeneration({
          submissionId: submission.id,
          sha256Hash: submission.sha256_hash,
          signature,
          publicKey,
          storageKey: storageKey!,
          tokenOwnerAddress: submission.token_owner_address,
          tokenOwnerPrivateKey: submission.token_owner_private_key!,
          uploadedAt: new Date(),
          correlationId: (req as any).correlationId,
        } as ProofGenerationJobData);

        // Update submission with job ID
        await this.submissionsRepo.updateJobId(submission.id, jobId);
        logger.info({ jobId, submissionId: submission.id }, 'Proof generation job enqueued');
      } catch (error) {
        logger.error({ err: error }, 'Failed to enqueue job, but submission created');
        // Don't fail the request - submission is created, job can be retried
      }

      // Return response
      res.status(201).json({
        submission: this.submissionsRepo.toResponse(submission),
      });
    } catch (error: any) {
      logger.error({ error }, 'Error creating submission');

      // Clean up on error
      if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      if (storageKey) {
        try {
          await this.storageService.deleteImage(storageKey);
        } catch (deleteError) {
          logger.warn({ err: deleteError }, 'Failed to delete MinIO image after error');
        }
      }

      // Handle specific errors
      if (error.message?.includes('already submitted')) {
        res.status(409).json({ error: error.message });
      } else if (error.message?.includes('No active challenge')) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  private async monitorProofGeneration(submissionId: string, sha256Hash: string) {
    try {
      // Poll authenticity record status
      const checkStatus = async () => {
        const record = await this.authenticityRepo.findByHash(sha256Hash);
        if (!record) return;

        const submission = await this.submissionsRepo.findById(submissionId);
        if (!submission) return;

        // Map authenticity status to submission status
        let newStatus: typeof submission.status | null = null;
        let imageUrl: string | undefined;

        switch (record.status) {
          case 'processing':
            newStatus = 'proving';
            break;
          case 'verified':
            newStatus = 'verified';
            // Generate MinIO URL for verified image
            imageUrl = await this.storage.getPublicUrl(sha256Hash);
            break;
          case 'failed':
            logger.error({ submissionId, sha256Hash }, 'Proof generation failed');
            return; // Don't update submission status on failure
        }

        if (newStatus && newStatus !== submission.status) {
          await this.submissionsRepo.updateStatus(submissionId, newStatus, imageUrl);
          logger.info({ submissionId, newStatus }, 'Updated submission status');
        }

        // Continue monitoring if not yet verified
        if (record.status !== 'verified' && record.status !== 'failed') {
          setTimeout(checkStatus, 5000); // Check every 5 seconds
        }
      };

      // Start monitoring after a delay
      setTimeout(checkStatus, 2000);
    } catch (error) {
      logger.error({ error, submissionId }, 'Error monitoring proof generation');
    }
  }
}
```

## 4. Handler Layer Implementation

### Step 4.1: Create Users Handler

Create `src/handlers/users.handler.ts`:

```typescript
import { Request, Response } from 'express';
import { UsersRepository } from '../db/repositories/users.repository.js';
import { logger } from '../utils/logger.js';

// Response types defined where they're used
export interface UserResponse {
  walletAddress: string;
  createdAt: Date;
}

export class UsersHandler {
  constructor(private readonly usersRepo: UsersRepository) {}

  async getUser(req: Request, res: Response): Promise<void> {
    try {
      const { walletAddress } = req.params;

      if (!walletAddress) {
        res.status(400).json({ error: 'Wallet address is required' });
        return;
      }

      const user = await this.usersRepo.findByWalletAddress(walletAddress);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ user: this.usersRepo.toResponse(user) });
    } catch (error) {
      logger.error({ error }, 'Error getting user');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async createUser(req: Request, res: Response): Promise<void> {
    try {
      const { walletAddress } = req.body;

      if (!walletAddress) {
        res.status(400).json({ error: 'Wallet address is required' });
        return;
      }

      // Check if user already exists
      const existing = await this.usersRepo.findByWalletAddress(walletAddress);
      if (existing) {
        res.json({ user: this.usersRepo.toResponse(existing) });
        return;
      }

      const user = await this.usersRepo.create({ walletAddress });
      res.status(201).json({ user: this.usersRepo.toResponse(user) });
    } catch (error) {
      logger.error({ error }, 'Error creating user');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
```

### Step 4.2: Create Challenges Handler

Create `src/handlers/challenges.handler.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class ChallengesHandler {
  constructor(private readonly challengesRepo: ChallengesRepository) {}

  async getCurrentChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const challenge = await this.challengesRepo.findCurrent();

      if (!challenge) {
        throw Errors.challengeNotFound();
      }

      res.json(this.challengesRepo.toResponse(challenge));
    } catch (error) {
      next(error); // Error middleware handles it
    }
  }

  async getAllChallenges(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const challenges = await this.challengesRepo.findAll();
      res.json(challenges.map(c => this.challengesRepo.toResponse(c)));
    } catch (error) {
      next(error);
    }
  }
}
```

### Step 4.3: Create Chains Handler

Create `src/handlers/chains.handler.ts`:

```typescript
import { Request, Response } from 'express';
import { ChainsRepository } from '../db/repositories/chains.repository.js';
import { logger } from '../utils/logger.js';

export class ChainsHandler {
  constructor(private readonly chainsRepo: ChainsRepository) {}

  async getChain(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const chain = await this.chainsRepo.findById(id);

      if (!chain) {
        res.status(404).json({ error: 'Chain not found' });
        return;
      }

      res.json(this.chainsRepo.toResponse(chain));
    } catch (error) {
      logger.error({ error }, 'Error getting chain');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getChainsForChallenge(req: Request, res: Response): Promise<void> {
    try {
      const { challengeId } = req.query;

      if (!challengeId || typeof challengeId !== 'string') {
        res.status(400).json({ error: 'Challenge ID is required' });
        return;
      }

      const chains = await this.chainsRepo.findByChallengeId(challengeId);
      res.json(chains.map(c => this.chainsRepo.toResponse(c)));
    } catch (error) {
      logger.error({ error }, 'Error getting chains');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
```

### Step 4.4: Create Submissions Handler

Create `src/handlers/submissions.handler.ts`:

```typescript
import { Request, Response } from 'express';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { SubmissionService } from '../services/submission.service.js';
import { logger } from '../utils/logger.js';

export class SubmissionsHandler {
  constructor(
    private readonly submissionsRepo: SubmissionsRepository,
    private readonly submissionService: SubmissionService
  ) {}

  async getSubmissions(req: Request, res: Response): Promise<void> {
    try {
      const { walletAddress, challengeId, chainId, page, limit } = req.query;

      const query = {
        walletAddress: walletAddress as string | undefined,
        challengeId: challengeId as string | undefined,
        chainId: chainId as string | undefined,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
      };

      const result = await this.submissionsRepo.findWithQuery(query);

      res.json({
        submissions: result.submissions.map(s => this.submissionsRepo.toResponse(s)),
        total: result.total,
        page: query.page,
        limit: query.limit,
      });
    } catch (error) {
      logger.error({ error }, 'Error getting submissions');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getSubmission(req: Request, res: Response): Promise<void> {
    try {
      const { submissionId } = req.params;

      const submission = await this.submissionsRepo.findById(submissionId);

      if (!submission) {
        res.status(404).json({ error: 'Submission not found' });
        return;
      }

      res.json(this.submissionsRepo.toResponse(submission));
    } catch (error) {
      logger.error({ error }, 'Error getting submission');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async createSubmission(req: Request, res: Response): Promise<void> {
    try {
      const { image, tagline, signedTransaction } = req.body;

      // Get wallet address from signed transaction
      // This is a placeholder - you'll need to implement transaction verification
      const walletAddress = req.body.walletAddress; // For MVP, pass directly

      if (!image || !walletAddress) {
        res.status(400).json({
          error: 'Missing required fields',
          fields: {
            image: !image ? 'Image is required' : undefined,
            walletAddress: !walletAddress ? 'Wallet address is required' : undefined,
          }
        });
        return;
      }

      // For MVP, we'll use the sha256Hash from the existing upload flow
      // In production, this would come from processing the image
      const sha256Hash = req.body.sha256Hash;
      const tokenOwnerAddress = req.body.tokenOwnerAddress;

      const submission = await this.submissionService.createSubmission({
        walletAddress,
        sha256Hash,
        tokenOwnerAddress,
        tagline,
        signedTransaction,
      });

      res.status(201).json({ submission });
    } catch (error: any) {
      logger.error({ error }, 'Error creating submission');

      if (error.message.includes('already submitted')) {
        res.status(409).json({ error: error.message });
      } else if (error.message.includes('No active challenge')) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
```

## 5. Routes Implementation

### Step 5.1: Create Routes Files

Create `src/api/routes/users.routes.ts`:

```typescript
import { Router } from 'express';
import { UsersHandler } from '../../handlers/users.handler.js';
import { asyncErrorHandler } from '../middleware/errorHandler.js';

export function createUsersRoutes(handler: UsersHandler): Router {
  const router = Router();

  router.get('/:walletAddress', asyncErrorHandler(handler.getUser.bind(handler)));
  router.post('/', asyncErrorHandler(handler.createUser.bind(handler)));

  return router;
}
```

Create `src/api/routes/challenges.routes.ts`:

```typescript
import { Router } from 'express';
import { ChallengesHandler } from '../../handlers/challenges.handler.js';
import { asyncErrorHandler } from '../middleware/errorHandler.js';

export function createChallengesRoutes(handler: ChallengesHandler): Router {
  const router = Router();

  router.get('/current', asyncErrorHandler(handler.getCurrentChallenge.bind(handler)));
  router.get('/', asyncErrorHandler(handler.getAllChallenges.bind(handler)));

  return router;
}
```

Create `src/api/routes/chains.routes.ts`:

```typescript
import { Router } from 'express';
import { ChainsHandler } from '../../handlers/chains.handler.js';
import { asyncErrorHandler } from '../middleware/errorHandler.js';

export function createChainsRoutes(handler: ChainsHandler): Router {
  const router = Router();

  router.get('/:id', asyncErrorHandler(handler.getChain.bind(handler)));
  router.get('/', asyncErrorHandler(handler.getChainsForChallenge.bind(handler)));

  return router;
}
```

Create `src/api/routes/submissions.routes.ts`:

```typescript
import { Router } from 'express';
import { SubmissionsHandler } from '../../handlers/submissions.handler.js';
import { asyncErrorHandler } from '../middleware/errorHandler.js';

export function createSubmissionsRoutes(handler: SubmissionsHandler): Router {
  const router = Router();

  router.get('/', asyncErrorHandler(handler.getSubmissions.bind(handler)));
  router.get('/:submissionId', asyncErrorHandler(handler.getSubmission.bind(handler)));
  router.post('/', asyncErrorHandler(handler.createSubmission.bind(handler)));

  return router;
}
```

### Step 5.2: Update Main Routes File

Update `src/api/routes/index.ts`:

```typescript
import { Router } from 'express';
import { createUploadRoutes } from './upload.routes.js';
import { createStatusRoutes } from './status.routes.js';
import { createTokenOwnerRoutes } from './tokenOwner.routes.js';
import { createAdminRoutes } from './admin.routes.js';
import { createUsersRoutes } from './users.routes.js';
import { createChallengesRoutes } from './challenges.routes.js';
import { createChainsRoutes } from './chains.routes.js';
import { createSubmissionsRoutes } from './submissions.routes.js';

// Import handlers
import { UploadHandler } from '../../handlers/upload.handler.js';
import { StatusHandler } from '../../handlers/status.handler.js';
import { TokenOwnerHandler } from '../../handlers/tokenOwner.handler.js';
import { AdminHandler } from '../../handlers/admin.handler.js';
import { UsersHandler } from '../../handlers/users.handler.js';
import { ChallengesHandler } from '../../handlers/challenges.handler.js';
import { ChainsHandler } from '../../handlers/chains.handler.js';
import { SubmissionsHandler } from '../../handlers/submissions.handler.js';

export function createApiRoutes(
  uploadHandler: UploadHandler,
  statusHandler: StatusHandler,
  tokenOwnerHandler: TokenOwnerHandler,
  adminHandler: AdminHandler,
  usersHandler: UsersHandler,
  challengesHandler: ChallengesHandler,
  chainsHandler: ChainsHandler,
  submissionsHandler: SubmissionsHandler
): Router {
  const router = Router();

  // Existing routes
  router.use('/upload', createUploadRoutes(uploadHandler));
  router.use('/status', createStatusRoutes(statusHandler));
  router.use('/token-owner', createTokenOwnerRoutes(tokenOwnerHandler));
  router.use('/admin', createAdminRoutes(adminHandler));

  // TouchGrass MVP routes
  router.use('/users', createUsersRoutes(usersHandler));
  router.use('/challenges', createChallengesRoutes(challengesHandler));
  router.use('/chains', createChainsRoutes(chainsHandler));
  router.use('/submissions', createSubmissionsRoutes(submissionsHandler));

  // Version endpoint
  router.get('/version', (req, res) => {
    res.json({ version: '1.0.0' });
  });

  return router;
}
```

## 6. Unit Testing

### Step 6.1: Test Users Handler

Create `test/handlers/users.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersHandler } from '../../src/handlers/users.handler.js';
import { UsersRepository } from '../../src/db/repositories/users.repository.js';
import { mock, MockProxy } from 'vitest-mock-extended';
import { Request, Response } from 'express';

describe('UsersHandler', () => {
  let handler: UsersHandler;
  let mockRepo: MockProxy<UsersRepository>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockRepo = mock<UsersRepository>();
    handler = new UsersHandler(mockRepo);

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  });

  describe('getUser', () => {
    it('should return user when found', async () => {
      const walletAddress = '0x123...abc';
      const mockUser = {
        id: 'user-id',
        wallet_address: walletAddress,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockReq = {
        params: { walletAddress },
      };

      mockRepo.findByWalletAddress.mockResolvedValue(mockUser);
      mockRepo.toResponse.mockReturnValue({
        id: mockUser.id,
        walletAddress: mockUser.wallet_address,
        createdAt: new Date(mockUser.created_at),
      });

      await handler.getUser(mockReq as Request, mockRes as Response);

      expect(mockRepo.findByWalletAddress).toHaveBeenCalledWith(walletAddress);
      expect(mockRes.json).toHaveBeenCalledWith({
        user: {
          id: mockUser.id,
          walletAddress: mockUser.wallet_address,
          createdAt: new Date(mockUser.created_at),
        },
      });
    });

    it('should return 404 when user not found', async () => {
      mockReq = {
        params: { walletAddress: 'unknown' },
      };

      mockRepo.findByWalletAddress.mockResolvedValue(null);

      await handler.getUser(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('should return 400 when wallet address missing', async () => {
      mockReq = {
        params: {},
      };

      await handler.getUser(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Wallet address is required' });
    });
  });

  describe('createUser', () => {
    it('should create new user', async () => {
      const walletAddress = '0x456...def';
      const mockUser = {
        id: 'new-user-id',
        wallet_address: walletAddress,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockReq = {
        body: { walletAddress },
      };

      mockRepo.findByWalletAddress.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(mockUser);
      mockRepo.toResponse.mockReturnValue({
        id: mockUser.id,
        walletAddress: mockUser.wallet_address,
        createdAt: new Date(mockUser.created_at),
      });

      await handler.createUser(mockReq as Request, mockRes as Response);

      expect(mockRepo.create).toHaveBeenCalledWith({ walletAddress });
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        user: {
          id: mockUser.id,
          walletAddress: mockUser.wallet_address,
          createdAt: new Date(mockUser.created_at),
        },
      });
    });

    it('should return existing user without creating duplicate', async () => {
      const walletAddress = '0x789...ghi';
      const mockUser = {
        id: 'existing-user-id',
        wallet_address: walletAddress,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockReq = {
        body: { walletAddress },
      };

      mockRepo.findByWalletAddress.mockResolvedValue(mockUser);
      mockRepo.toResponse.mockReturnValue({
        id: mockUser.id,
        walletAddress: mockUser.wallet_address,
        createdAt: new Date(mockUser.created_at),
      });

      await handler.createUser(mockReq as Request, mockRes as Response);

      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        user: {
          id: mockUser.id,
          walletAddress: mockUser.wallet_address,
          createdAt: new Date(mockUser.created_at),
        },
      });
    });

    it('should return 400 when wallet address missing', async () => {
      mockReq = {
        body: {},
      };

      await handler.createUser(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Wallet address is required' });
    });
  });
});
```

### Step 6.2: Test Submissions Repository

Create `test/repositories/submissions.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubmissionsRepository } from '../../src/db/repositories/submissions.repository.js';
import { PostgresAdapter } from '../../src/db/adapters/PostgresAdapter.js';
import knex from 'knex';

describe('SubmissionsRepository', () => {
  let repo: SubmissionsRepository;
  let db: PostgresAdapter;
  let testDb: any;

  beforeEach(async () => {
    // Use in-memory SQLite for testing
    testDb = knex({
      client: 'sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });

    // Create test tables
    await testDb.schema.createTable('users', (table: any) => {
      table.uuid('id').primary();
      table.string('wallet_address').unique();
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    await testDb.schema.createTable('challenges', (table: any) => {
      table.uuid('id').primary();
      table.string('title');
      table.text('description');
      table.timestamp('start_time');
      table.timestamp('end_time');
      table.integer('participant_count');
      table.integer('chain_count');
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    await testDb.schema.createTable('chains', (table: any) => {
      table.uuid('id').primary();
      table.string('name');
      table.uuid('challenge_id');
      table.integer('length');
      table.timestamp('created_at');
      table.timestamp('last_activity_at');
      table.timestamp('updated_at');
    });

    await testDb.schema.createTable('authenticity_records', (table: any) => {
      table.string('sha256_hash').primary();
      table.string('token_owner_address');
      table.string('status');
      table.timestamp('created_at');
    });

    await testDb.schema.createTable('submissions', (table: any) => {
      table.uuid('id').primary();
      table.string('sha256_hash').unique();
      table.string('token_owner_address');
      table.uuid('user_id');
      table.uuid('challenge_id');
      table.uuid('chain_id');
      table.string('image_url');
      table.string('tagline');
      table.integer('chain_position');
      table.string('status');
      table.boolean('challenge_verified');
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    db = new PostgresAdapter(testDb);
    repo = new SubmissionsRepository(db);
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  describe('create', () => {
    it('should create a new submission', async () => {
      // Insert test data
      await testDb('users').insert({
        id: 'user-1',
        wallet_address: '0x123',
        created_at: new Date(),
        updated_at: new Date(),
      });

      await testDb('challenges').insert({
        id: 'challenge-1',
        title: 'Test Challenge',
        description: 'Test',
        start_time: new Date(),
        end_time: new Date(Date.now() + 86400000),
        participant_count: 0,
        chain_count: 1,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await testDb('chains').insert({
        id: 'chain-1',
        name: 'Default',
        challenge_id: 'challenge-1',
        length: 0,
        created_at: new Date(),
        last_activity_at: new Date(),
        updated_at: new Date(),
      });

      await testDb('authenticity_records').insert({
        sha256_hash: 'hash123',
        token_owner_address: '0xtoken',
        status: 'pending',
        created_at: new Date(),
      });

      const submission = await repo.create({
        sha256Hash: 'hash123',
        tokenOwnerAddress: '0xtoken',
        userId: 'user-1',
        challengeId: 'challenge-1',
        chainId: 'chain-1',
        tagline: 'Test tagline',
        chainPosition: 1,
      });

      expect(submission).toBeDefined();
      expect(submission.sha256_hash).toBe('hash123');
      expect(submission.user_id).toBe('user-1');
      expect(submission.tagline).toBe('Test tagline');
      expect(submission.status).toBe('uploading');
    });
  });

  describe('findWithQuery', () => {
    it('should find submissions by wallet address', async () => {
      // Insert test data
      await testDb('users').insert([
        {
          id: 'user-1',
          wallet_address: '0x123',
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'user-2',
          wallet_address: '0x456',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      await testDb('challenges').insert({
        id: 'challenge-1',
        title: 'Test Challenge',
        description: 'Test',
        start_time: new Date(),
        end_time: new Date(Date.now() + 86400000),
        participant_count: 0,
        chain_count: 1,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await testDb('chains').insert({
        id: 'chain-1',
        name: 'Default',
        challenge_id: 'challenge-1',
        length: 2,
        created_at: new Date(),
        last_activity_at: new Date(),
        updated_at: new Date(),
      });

      await testDb('authenticity_records').insert([
        {
          sha256_hash: 'hash1',
          token_owner_address: '0xtoken1',
          status: 'verified',
          created_at: new Date(),
        },
        {
          sha256_hash: 'hash2',
          token_owner_address: '0xtoken2',
          status: 'verified',
          created_at: new Date(),
        },
      ]);

      await testDb('submissions').insert([
        {
          id: 'submission-1',
          sha256_hash: 'hash1',
          token_owner_address: '0xtoken1',
          user_id: 'user-1',
          challenge_id: 'challenge-1',
          chain_id: 'chain-1',
          chain_position: 1,
          status: 'verified',
          challenge_verified: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'submission-2',
          sha256_hash: 'hash2',
          token_owner_address: '0xtoken2',
          user_id: 'user-2',
          challenge_id: 'challenge-1',
          chain_id: 'chain-1',
          chain_position: 2,
          status: 'verified',
          challenge_verified: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const result = await repo.findWithQuery({ walletAddress: '0x123' });

      expect(result.submissions).toHaveLength(1);
      expect(result.submissions[0].user_id).toBe('user-1');
      expect(result.total).toBe(1);
    });

    it('should paginate results', async () => {
      // Insert test data for pagination test
      // ... (similar setup with multiple submissions)

      const result = await repo.findWithQuery({ page: 1, limit: 10 });

      expect(result.submissions.length).toBeLessThanOrEqual(10);
    });
  });
});
```

### Step 6.3: Test Submission Service

Create `test/services/submission.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubmissionService } from '../../src/services/submission.service.js';
import { mock, MockProxy } from 'vitest-mock-extended';

describe('SubmissionService', () => {
  let service: SubmissionService;
  let mockUsersRepo: MockProxy<any>;
  let mockChallengesRepo: MockProxy<any>;
  let mockChainsRepo: MockProxy<any>;
  let mockSubmissionsRepo: MockProxy<any>;
  let mockAuthenticityRepo: MockProxy<any>;
  let mockJobQueue: MockProxy<any>;
  let mockStorage: MockProxy<any>;
  let mockDb: MockProxy<any>;

  beforeEach(() => {
    mockUsersRepo = mock();
    mockChallengesRepo = mock();
    mockChainsRepo = mock();
    mockSubmissionsRepo = mock();
    mockAuthenticityRepo = mock();
    mockJobQueue = mock();
    mockStorage = mock();
    mockDb = mock();

    // Setup transaction mock
    mockDb.getKnex.mockReturnValue({
      transaction: vi.fn((callback) => callback({})),
    });

    service = new SubmissionService(
      mockUsersRepo,
      mockChallengesRepo,
      mockChainsRepo,
      mockSubmissionsRepo,
      mockAuthenticityRepo,
      mockJobQueue,
      mockStorage,
      mockDb
    );
  });

  describe('createSubmission', () => {
    it('should create submission for new user', async () => {
      const mockUser = { id: 'user-1', wallet_address: '0x123' };
      const mockChallenge = { id: 'challenge-1', title: 'Test' };
      const mockChain = { id: 'chain-1', name: 'Default' };
      const mockSubmission = {
        id: 'submission-1',
        sha256_hash: 'hash123',
        user_id: 'user-1',
        status: 'uploading',
      };

      mockUsersRepo.findOrCreate.mockResolvedValue(mockUser);
      mockChallengesRepo.findCurrent.mockResolvedValue(mockChallenge);
      mockSubmissionsRepo.findByUserAndChallenge.mockResolvedValue(null);
      mockAuthenticityRepo.checkExists.mockResolvedValue({ exists: true });
      mockChainsRepo.findOrCreateForChallenge.mockResolvedValue(mockChain);
      mockSubmissionsRepo.getNextChainPosition.mockResolvedValue(1);
      mockSubmissionsRepo.create.mockResolvedValue(mockSubmission);
      mockSubmissionsRepo.toResponse.mockReturnValue({
        id: mockSubmission.id,
        status: mockSubmission.status,
      });

      const result = await service.createSubmission({
        walletAddress: '0x123',
        sha256Hash: 'hash123',
        tokenOwnerAddress: '0xtoken',
        tagline: 'Test',
        signedTransaction: 'sig',
      });

      expect(result).toBeDefined();
      expect(mockUsersRepo.findOrCreate).toHaveBeenCalledWith('0x123');
      expect(mockSubmissionsRepo.create).toHaveBeenCalled();
    });

    it('should throw error if user already submitted', async () => {
      const mockUser = { id: 'user-1', wallet_address: '0x123' };
      const mockChallenge = { id: 'challenge-1', title: 'Test' };
      const existingSubmission = { id: 'existing', user_id: 'user-1' };

      mockUsersRepo.findOrCreate.mockResolvedValue(mockUser);
      mockChallengesRepo.findCurrent.mockResolvedValue(mockChallenge);
      mockSubmissionsRepo.findByUserAndChallenge.mockResolvedValue(existingSubmission);

      await expect(
        service.createSubmission({
          walletAddress: '0x123',
          sha256Hash: 'hash123',
          tokenOwnerAddress: '0xtoken',
          tagline: 'Test',
          signedTransaction: 'sig',
        })
      ).rejects.toThrow('User has already submitted for this challenge');
    });

    it('should throw error if no active challenge', async () => {
      const mockUser = { id: 'user-1', wallet_address: '0x123' };

      mockUsersRepo.findOrCreate.mockResolvedValue(mockUser);
      mockChallengesRepo.findCurrent.mockResolvedValue(null);

      await expect(
        service.createSubmission({
          walletAddress: '0x123',
          sha256Hash: 'hash123',
          tokenOwnerAddress: '0xtoken',
          tagline: 'Test',
          signedTransaction: 'sig',
        })
      ).rejects.toThrow('No active challenge found');
    });
  });
});
```

## 7. Worker Implementation

### Step 7.1: Create Submission Proof Worker

Create `src/workers/submissionProofWorker.ts`:

```typescript
import PgBoss from 'pg-boss';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { ImageAuthenticityService } from '../services/image/verification.service.js';
import { MinioStorageService } from '../services/storage/storageService.js';
import { ProofGenerationService } from '../services/zk/proofGeneration.service.js';
import { ProofPublishingService } from '../services/zk/proofPublishing.service.js';
import { ProofGenerationJobData } from '../db/types/touchgrass.types.js';
import fs from 'fs/promises';
import { logger, withContext } from '../utils/logger.js';
import { PerformanceTracker } from '../utils/performance.js';

export class SubmissionProofWorker {
  constructor(
    private boss: PgBoss,
    private repository: SubmissionsRepository,
    private imageAuthenticityService: ImageAuthenticityService,
    private proofGenerationService: ProofGenerationService,
    private proofPublishingService: ProofPublishingService,
    private storageService: MinioStorageService
  ) {}

  async start(): Promise<void> {
    // Register worker for proof-generation jobs
    await this.boss.work<ProofGenerationJobData>('proof-generation', async (jobs) => {
      for (const job of jobs) {
        await withContext(
          {
            jobId: job.id,
            submissionId: job.data.submissionId,
            sha256Hash: job.data.sha256Hash,
            correlationId: job.data.correlationId,
            attempt: (job as any).retryCount || 0,
          },
          async () => {
            const jobTracker = new PerformanceTracker('job.submissionProof', {
              sha256Hash: job.data.sha256Hash,
              submissionId: job.data.submissionId,
            });

            const {
              submissionId,
              sha256Hash,
              signature,
              publicKey,
              storageKey,
              tokenOwnerAddress,
              tokenOwnerPrivateKey,
            } = job.data;

            logger.info('Starting submission proof generation job');

            const tempPath = `/tmp/${sha256Hash}.png`;

            try {
              // Update status to proving
              await this.repository.updateStatus(sha256Hash, 'proving', {
                retry_count: (job as any).retryCount || 0,
              });

              // Download image from MinIO
              const imageBuffer = await this.storageService.downloadImage(storageKey);
              await fs.writeFile(tempPath, imageBuffer);

              // Verify and prepare image
              logger.info('Verifying and preparing image');
              const verifyTracker = new PerformanceTracker('job.verifyImage');
              const { isValid, verificationInputs, error } =
                this.imageAuthenticityService.verifyAndPrepareImage(tempPath, signature, publicKey);
              verifyTracker.end(isValid ? 'success' : 'error');

              if (!isValid || !verificationInputs) {
                throw new Error(`Image verification failed: ${error || 'Unknown error'}`);
              }

              // Generate proof
              logger.info('Generating zero-knowledge proof');
              const proofTracker = new PerformanceTracker('job.generateProof');
              const { proof, publicInputs } = await this.proofGenerationService.generateProof(
                sha256Hash,
                publicKey,
                signature,
                verificationInputs,
                tempPath
              );
              proofTracker.end('success');

              // Publish to blockchain
              logger.info('Publishing proof to Mina blockchain');
              const publishTracker = new PerformanceTracker('job.publishProof');
              const transactionId = await this.proofPublishingService.publishProof(
                sha256Hash,
                proof,
                publicInputs,
                tokenOwnerPrivateKey
              );
              publishTracker.end('success', { transactionId });

              // Update submission to awaiting confirmation
              await this.repository.updateStatus(sha256Hash, 'awaiting_confirmation', {
                transaction_id: transactionId,
              });

              // In production, you would monitor the transaction and update to 'verified' once confirmed
              // For MVP, we'll mark as verified immediately
              await this.repository.updateStatus(sha256Hash, 'verified', {
                transaction_id: transactionId,
              });

              // Clean up temp file and MinIO
              try {
                await fs.unlink(tempPath);
                await this.storageService.deleteImage(storageKey);
                logger.debug('Cleaned up temp file and MinIO');
              } catch (cleanupError) {
                logger.warn({ err: cleanupError }, 'Failed to clean up');
              }

              jobTracker.end('success', { transactionId });
              logger.info({ transactionId, submissionId }, 'Proof generation completed successfully');
            } catch (error) {
              const retryCount = (job as any).retryCount || 0;
              const retryLimit = 3;
              const isLastRetry = retryCount >= retryLimit - 1;

              logger.error(
                {
                  err: error,
                  isLastRetry,
                  submissionId,
                },
                'Proof generation failed'
              );

              // Update failure status
              await this.repository.updateStatus(
                sha256Hash,
                isLastRetry ? 'failed' : 'pending',
                {
                  failure_reason: error instanceof Error ? error.message : 'Unknown error',
                  retry_count: retryCount + 1,
                }
              );

              // Clean up on final failure
              if (isLastRetry) {
                try {
                  await fs.unlink(tempPath);
                  await this.storageService.deleteImage(storageKey);
                  logger.debug('Cleaned up after final failure');
                } catch (cleanupError) {
                  logger.warn({ err: cleanupError }, 'Failed to clean up after failure');
                }
              }

              // Re-throw to trigger pg-boss retry
              throw error;
            }
          }
        );
      }
    });

    logger.info('Submission proof generation worker started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping submission worker...');
  }
}
```

## 8. Integration Testing

### Step 7.1: Create API Integration Test

Create `test/integration/api.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js'; // Assuming app is exported
import { PostgresAdapter } from '../../src/db/adapters/PostgresAdapter.js';

describe('API Integration Tests', () => {
  let db: PostgresAdapter;

  beforeAll(async () => {
    // Setup test database
    // ... initialization code
  });

  afterAll(async () => {
    // Cleanup
    await db.getKnex().destroy();
  });

  describe('User Flow', () => {
    it('should create user and retrieve it', async () => {
      const walletAddress = '0xtest' + Date.now();

      // Create user
      const createRes = await request(app)
        .post('/api/users')
        .send({ walletAddress })
        .expect(201);

      expect(createRes.body.user).toBeDefined();
      expect(createRes.body.user.walletAddress).toBe(walletAddress);

      // Retrieve user
      const getRes = await request(app)
        .get(`/api/users/${walletAddress}`)
        .expect(200);

      expect(getRes.body.user.id).toBe(createRes.body.user.id);
    });
  });

  describe('Challenge Flow', () => {
    it('should get current challenge', async () => {
      // Assuming a challenge exists in test data
      const res = await request(app)
        .get('/api/challenges/current')
        .expect(200);

      expect(res.body).toBeDefined();
      expect(res.body.title).toBeDefined();
      expect(res.body.endTime).toBeDefined();
    });
  });

  describe('Submission Flow', () => {
    it('should create and retrieve submission', async () => {
      // This would require setting up test data
      // Including users, challenges, chains, and authenticity records

      const walletAddress = '0xsubmit' + Date.now();

      // First create user
      await request(app)
        .post('/api/users')
        .send({ walletAddress })
        .expect(201);

      // Then create submission (requires more setup)
      // ... submission creation test
    });

    it('should paginate submissions', async () => {
      const res = await request(app)
        .get('/api/submissions?page=1&limit=10')
        .expect(200);

      expect(res.body.submissions).toBeDefined();
      expect(Array.isArray(res.body.submissions)).toBe(true);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
    });
  });
});
```

## 8. Admin Functionality

### Step 8.1: Create Admin Submissions Handler

Create `src/handlers/adminSubmissions.handler.ts`:

```typescript
import { Request, Response } from 'express';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { MinioStorageService } from '../services/storage/storageService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export class AdminSubmissionsHandler {
  constructor(
    private readonly submissionsRepo: SubmissionsRepository,
    private readonly storage: MinioStorageService
  ) {}

  async getAllSubmissionsWithImages(req: Request, res: Response): Promise<void> {
    try {
      // Check admin authentication
      if (!this.isAdminAuthenticated(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { challengeId, verified } = req.query;

      // Get all submissions
      const query: any = {};
      if (challengeId) query.challengeId = challengeId as string;

      const result = await this.submissionsRepo.findWithQuery({
        ...query,
        limit: 1000, // Admin can see all
      });

      // Add MinIO URLs to submissions
      const submissionsWithUrls = await Promise.all(
        result.submissions.map(async (submission) => {
          const imageUrl = await this.storage.getPublicUrl(submission.sha256_hash);
          return {
            ...this.submissionsRepo.toResponse(submission),
            imageUrl,
            challengeVerified: submission.challenge_verified,
          };
        })
      );

      res.json({
        submissions: submissionsWithUrls,
        total: result.total,
      });
    } catch (error) {
      logger.error({ error }, 'Error getting admin submissions');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async verifySubmission(req: Request, res: Response): Promise<void> {
    try {
      if (!this.isAdminAuthenticated(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { submissionId } = req.params;
      const { verified } = req.body;

      if (typeof verified !== 'boolean') {
        res.status(400).json({ error: 'Verified must be a boolean' });
        return;
      }

      const submission = await this.submissionsRepo.findById(submissionId);
      if (!submission) {
        res.status(404).json({ error: 'Submission not found' });
        return;
      }

      // Update challenge verification status
      await this.submissionsRepo.updateChallengeVerified(submissionId, verified);

      // TODO: If verified=true, trigger blockchain update with admin key
      if (verified) {
        logger.info({ submissionId }, 'Submission approved by admin');
        // This would trigger a blockchain transaction to update challengeVerified=true
        // using the server's admin key
      } else {
        logger.info({ submissionId }, 'Submission rejected by admin');
      }

      res.json({ success: true, verified });
    } catch (error) {
      logger.error({ error }, 'Error verifying submission');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private isAdminAuthenticated(req: Request): boolean {
    // For development, allow if NODE_ENV is development
    if (config.NODE_ENV === 'development') {
      return true;
    }

    // In production, check for admin API key or basic auth
    const adminKey = req.headers['x-admin-api-key'];
    if (adminKey === config.ADMIN_API_KEY) {
      return true;
    }

    // Check basic auth (hardcoded for MVP)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Basic ')) {
      const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
      // For MVP: hardcoded credentials
      return credentials === 'admin:o1labs-admin-2024';
    }

    return false;
  }
}
```

### Step 8.2: Create Admin Routes

Create `src/api/routes/adminSubmissions.routes.ts`:

```typescript
import { Router } from 'express';
import { AdminSubmissionsHandler } from '../../handlers/adminSubmissions.handler.js';
import { asyncErrorHandler } from '../middleware/errorHandler.js';

export function createAdminSubmissionsRoutes(handler: AdminSubmissionsHandler): Router {
  const router = Router();

  router.get('/submissions', asyncErrorHandler(handler.getAllSubmissionsWithImages.bind(handler)));
  router.post('/submissions/:submissionId/verify', asyncErrorHandler(handler.verifySubmission.bind(handler)));

  return router;
}
```

## Implementation Checklist

Follow this order for implementation:

1. **Database Setup**
   - [x] Create and run migrations for all tables
   - [ ] Verify tables are created correctly

2. **Type Definitions**
   - [x] Create `touchgrass.types.ts` with all interfaces
   - [x] Update existing types as needed
   - [x] Move response types to handlers (not in DB types)

3. **Repository Layer**
   - [ ] Implement UsersRepository
   - [ ] Implement ChallengesRepository
   - [ ] Implement ChainsRepository
   - [ ] Implement SubmissionsRepository

4. **Service Layer**
   - [ ] Implement SubmissionService
   - [ ] Wire up dependencies in main index.ts

5. **Handler Layer**
   - [ ] Implement UsersHandler
   - [ ] Implement ChallengesHandler
   - [ ] Implement ChainsHandler
   - [ ] Implement SubmissionsHandler

6. **Routes**
   - [ ] Create all route files
   - [ ] Update main routes file to include new routes

7. **Testing**
   - [ ] Write unit tests for handlers
   - [ ] Write unit tests for repositories
   - [ ] Write unit tests for services
   - [ ] Write integration tests

8. **Admin Functionality**
   - [ ] Implement AdminSubmissionsHandler
   - [ ] Create admin routes
   - [ ] Test admin authentication

## Testing the Implementation

### Manual Testing with curl

```bash
# Create user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0x1234567890abcdef"}'

# Get user
curl http://localhost:3000/api/users/0x1234567890abcdef

# Get current challenge
curl http://localhost:3000/api/challenges/current

# Get submissions for a chain
curl "http://localhost:3000/api/submissions?chainId=<chain-id>&page=1&limit=20"

# Admin: Get all submissions (dev mode)
curl http://localhost:3000/api/admin/submissions

# Admin: Verify submission (dev mode)
curl -X POST http://localhost:3000/api/admin/submissions/<submission-id>/verify \
  -H "Content-Type: application/json" \
  -d '{"verified": true}'
```

### Running Tests

```bash
# Run all tests
npm run test

# Run specific test file
npm run test test/handlers/users.test.ts

# Run with coverage
npm run test -- --coverage
```

## Notes for Implementation

1. **Transaction Safety**: All submission creation logic uses database transactions to ensure consistency.

2. **Status Monitoring**: The submission service monitors the proof generation status by polling the authenticity record.

3. **Error Handling**: All handlers include proper error handling with specific HTTP status codes.

4. **Pagination**: All list endpoints support pagination with `page` and `limit` parameters.

5. **Admin Security**: Admin endpoints check for authentication in development/production modes.

6. **Testing Strategy**: Tests use mocks for unit tests and in-memory database for repository tests.

7. **Dependency Injection**: All components use constructor injection following the existing pattern.

This guide provides a complete implementation path for the TouchGrass MVP. Start with the database migrations and work your way through each layer, testing as you go.