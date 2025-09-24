# TouchGrass MVP Resource Implementation Guide

This guide walks through implementing each REST resource for the TouchGrass MVP. We build each resource completely before moving to the next.

## Prerequisites ✅
- Database tables created via migrations
- TypeScript types defined in `src/db/types/touchgrass.types.ts`
- Docker PostgreSQL running
- Environment variables configured

## Implementation Order

1. **Error Handling** - Shared utilities for all resources
2. **Challenge Resource** - `/api/challenges`
3. **Chain Resource** - `/api/chains`
4. **User Resource** - `/api/users`
5. **Submission Resource** - `/api/submissions`
6. **Wire Everything Together**

---

## 1. Error Handling Setup

### Create Error Utilities

`src/utils/errors.ts`:
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

export const Errors = {
  // Validation errors
  validationError: (message: string, field?: string) =>
    new ApiError('VALIDATION_ERROR', 400, message, field),

  missingField: (field: string) =>
    new ApiError('MISSING_FIELD', 400, `${field} is required`, field),

  // Not found errors
  notFound: (resource: string) =>
    new ApiError('NOT_FOUND', 404, `${resource} not found`),

  challengeNotFound: () =>
    new ApiError('CHALLENGE_NOT_FOUND', 404, 'No active challenge found'),

  // Conflict errors
  duplicateSubmission: () =>
    new ApiError('DUPLICATE_SUBMISSION', 409, 'User has already submitted for this challenge'),

  // Server errors
  internal: (message = 'An unexpected error occurred') =>
    new ApiError('INTERNAL_ERROR', 500, message),

  database: (message = 'Database operation failed') =>
    new ApiError('DATABASE_ERROR', 500, message),
};
```

### Create Validation Utilities

`src/utils/validation.ts`:
```typescript
import { PublicKey, Signature } from 'o1js';

export const Validators = {
  walletAddress: (address: string): boolean => {
    try {
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
};
```

---

## 2. Challenge Resource

### Repository

`src/db/repositories/challenges.repository.ts`:
```typescript
import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { Challenge } from '../types/touchgrass.types.js';

export interface ChallengeResponse {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  participantCount: number;
  chainCount: number;
}

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

### Handler

`src/handlers/challenges.handler.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import { Errors } from '../utils/errors.js';

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
      next(error);
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

  async getChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const challenge = await this.challengesRepo.findById(id);
      if (!challenge) {
        throw Errors.notFound('Challenge');
      }

      res.json(this.challengesRepo.toResponse(challenge));
    } catch (error) {
      next(error);
    }
  }
}
```

### Routes

`src/api/routes/challenges.routes.ts`:
```typescript
import { Router } from 'express';
import { ChallengesHandler } from '../../handlers/challenges.handler.js';
import { asyncErrorHandler } from '../middleware/errorHandler.js';

export function createChallengesRoutes(handler: ChallengesHandler): Router {
  const router = Router();

  router.get('/current', asyncErrorHandler(handler.getCurrentChallenge.bind(handler)));
  router.get('/:id', asyncErrorHandler(handler.getChallenge.bind(handler)));
  router.get('/', asyncErrorHandler(handler.getAllChallenges.bind(handler)));

  return router;
}
```

---

## 3. Chain Resource

**MVP Note**: For the MVP, each challenge automatically gets exactly one chain created when the challenge is created. No additional chains can be created. The chain serves as the single collection point for all submissions to that challenge.

### Repository

`src/db/repositories/chains.repository.ts`:
```typescript
import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { Chain } from '../types/touchgrass.types.js';
import { Knex } from 'knex';

export interface ChainResponse {
  id: string;
  name: string;
  challengeId: string;
  length: number;
  createdAt: Date;
  lastActivityAt: Date;
}

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
    if (chains.length > 0) return chains[0];

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

### Handler

`src/handlers/chains.handler.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';
import { ChainsRepository } from '../db/repositories/chains.repository.js';
import { Errors } from '../utils/errors.js';

export class ChainsHandler {
  constructor(private readonly chainsRepo: ChainsRepository) {}

  async getChain(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const chain = await this.chainsRepo.findById(id);
      if (!chain) {
        throw Errors.notFound('Chain');
      }

      res.json(this.chainsRepo.toResponse(chain));
    } catch (error) {
      next(error);
    }
  }

  async getChainsForChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { challengeId } = req.query;

      if (!challengeId || typeof challengeId !== 'string') {
        throw Errors.missingField('challengeId');
      }

      const chains = await this.chainsRepo.findByChallengeId(challengeId);
      res.json(chains.map(c => this.chainsRepo.toResponse(c)));
    } catch (error) {
      next(error);
    }
  }
}
```

### Routes

`src/api/routes/chains.routes.ts`:
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

---

## 4. User Resource

### Repository

`src/db/repositories/users.repository.ts`:
```typescript
import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { User } from '../types/touchgrass.types.js';
import { PublicKey } from 'o1js';

export interface CreateUserInput {
  walletAddress: string;
}

export interface UserResponse {
  walletAddress: string;
  createdAt: Date;
}

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
    // Validate wallet address
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

  toResponse(user: User): UserResponse {
    return {
      walletAddress: user.wallet_address,
      createdAt: new Date(user.created_at),
    };
  }
}
```

### Handler

`src/handlers/users.handler.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';
import { UsersRepository } from '../db/repositories/users.repository.js';
import { Errors } from '../utils/errors.js';
import { Validators } from '../utils/validation.js';

export class UsersHandler {
  constructor(private readonly usersRepo: UsersRepository) {}

  async getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { walletAddress } = req.params;

      if (!walletAddress) {
        throw Errors.missingField('walletAddress');
      }

      if (!Validators.walletAddress(walletAddress)) {
        throw Errors.validationError('Invalid wallet address format', 'walletAddress');
      }

      const user = await this.usersRepo.findByWalletAddress(walletAddress);
      if (!user) {
        throw Errors.notFound('User');
      }

      res.json(this.usersRepo.toResponse(user));
    } catch (error) {
      next(error);
    }
  }

  async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { walletAddress } = req.body;

      if (!walletAddress) {
        throw Errors.missingField('walletAddress');
      }

      if (!Validators.walletAddress(walletAddress)) {
        throw Errors.validationError('Invalid wallet address format', 'walletAddress');
      }

      const user = await this.usersRepo.findOrCreate(walletAddress);
      res.status(user ? 200 : 201).json(this.usersRepo.toResponse(user));
    } catch (error) {
      next(error);
    }
  }
}
```

### Routes

`src/api/routes/users.routes.ts`:
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

---

## 5. Submission Resource (Complex)

The submission resource is the most complex as it handles image uploads, proof generation, and integrates with the existing worker system.

[Details for submission resource would go here - this is the most complex part]

---

## 6. Wire Everything Together

### Update Main Routes

`src/api/routes/index.ts`:
```typescript
// Add to existing imports
import { createUsersRoutes } from './users.routes.js';
import { createChallengesRoutes } from './challenges.routes.js';
import { createChainsRoutes } from './chains.routes.js';
import { createSubmissionsRoutes } from './submissions.routes.js';

// Add to createApiRoutes function
export function createApiRoutes(
  // ... existing handlers ...
  usersHandler: UsersHandler,
  challengesHandler: ChallengesHandler,
  chainsHandler: ChainsHandler,
  submissionsHandler: SubmissionsHandler
): Router {
  const router = Router();

  // ... existing routes ...

  // TouchGrass MVP routes
  router.use('/users', createUsersRoutes(usersHandler));
  router.use('/challenges', createChallengesRoutes(challengesHandler));
  router.use('/chains', createChainsRoutes(chainsHandler));
  router.use('/submissions', createSubmissionsRoutes(submissionsHandler));

  return router;
}
```

### Update Main Index

`src/index.ts`:
```typescript
// Add repositories
const usersRepo = new UsersRepository(db);
const challengesRepo = new ChallengesRepository(db);
const chainsRepo = new ChainsRepository(db);
const submissionsRepo = new SubmissionsRepository(db);

// Add handlers
const usersHandler = new UsersHandler(usersRepo);
const challengesHandler = new ChallengesHandler(challengesRepo);
const chainsHandler = new ChainsHandler(chainsRepo);
const submissionsHandler = new SubmissionsHandler(
  submissionsRepo,
  usersRepo,
  challengesRepo,
  chainsRepo,
  // ... other services
);

// Pass to createApiRoutes
const apiRoutes = createApiRoutes(
  // ... existing handlers ...
  usersHandler,
  challengesHandler,
  chainsHandler,
  submissionsHandler
);
```

---

## Testing

### Manual Testing with curl

```bash
# Get current challenge
curl http://localhost:3000/api/challenges/current

# Get all challenges
curl http://localhost:3000/api/challenges

# Create user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "B62qj..."}'

# Get user
curl http://localhost:3000/api/users/B62qj...

# Get chains for challenge
curl "http://localhost:3000/api/chains?challengeId=<uuid>"
```

### Next Steps
1. Implement submission resource with full upload flow
2. Add unit tests for each resource
3. Add integration tests
4. Add admin endpoints if needed