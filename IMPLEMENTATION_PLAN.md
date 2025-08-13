# Provenance Backend Implementation Plan

## Executive Summary
This document provides a step-by-step implementation guide for building the Provenance Backend system that enables zero-knowledge proof-based image authenticity verification on the Mina blockchain. A developer new to the project can follow this plan to build the complete system from scratch.

## Prerequisites
- Node.js 18.14.0+ installed
- Basic understanding of TypeScript, Express.js, and SQLite
- Familiarity with Mina blockchain concepts
- Access to the Authenticity-Zkapp package

## Project Timeline
- **Days 1-2**: Project setup and infrastructure
- **Days 3-4**: Upload flow implementation
- **Days 5-7**: zkApp integration and proof generation
- **Days 8-9**: Verification endpoints and status tracking
- **Days 10-11**: Testing and deployment
- **Day 12**: Documentation and handoff

## Phase 1: Project Setup (Day 1)

### 1.1 Initialize Project
```bash
mkdir provenance-backend
cd provenance-backend
npm init -y
```

### 1.2 Install Dependencies
```bash
# Core dependencies
npm install express cors helmet compression dotenv
npm install multer sqlite3 better-sqlite3
npm install o1js authenticity-zkapp

# Development dependencies
npm install -D typescript @types/node @types/express
npm install -D @types/multer @types/cors @types/compression
npm install -D nodemon ts-node prettier eslint
npm install -D @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

### 1.3 Create Project Structure
```
provenance-backend/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── upload.routes.ts
│   │   │   ├── status.routes.ts
│   │   │   └── tokenOwner.routes.ts
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── error.middleware.ts
│   │   │   └── validation.middleware.ts
│   │   └── server.ts
│   ├── handlers/
│   │   ├── upload.handler.ts
│   │   ├── status.handler.ts
│   │   └── tokenOwner.handler.ts
│   ├── services/
│   │   ├── zk/
│   │   │   ├── proofGeneration.service.ts
│   │   │   ├── proofPublishing.service.ts
│   │   │   └── zkAppInteraction.service.ts
│   │   ├── image/
│   │   │   ├── hashing.service.ts
│   │   │   └── verification.service.ts
│   │   └── queue/
│   │       └── proofQueue.service.ts
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 001_initial_schema.sql
│   │   ├── database.ts
│   │   └── repositories/
│   │       └── authenticity.repository.ts
│   ├── types/
│   │   └── index.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   └── crypto.ts
│   └── index.ts
├── data/
│   └── .gitkeep
├── cache/
│   └── .gitkeep
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── .gitignore
├── tsconfig.json
├── package.json
└── README.md
```

### 1.4 Configure TypeScript
Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 1.5 Environment Configuration
Create `.env.example`:
```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_PATH=./data/provenance.db

# Mina Blockchain
MINA_NETWORK=testnet
DEPLOYER_PRIVATE_KEY=
FEE_PAYER_PRIVATE_KEY=
ZKAPP_ADDRESS=

# Upload
UPLOAD_MAX_SIZE=10485760

# Proof Generation
PROOF_GENERATION_TIMEOUT=120000
CIRCUIT_CACHE_PATH=./cache
```

## Phase 2: Database Layer (Day 2)

### 2.1 Database Schema
Create `src/db/migrations/001_initial_schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS authenticity_records (
  sha256_hash TEXT PRIMARY KEY,
  token_owner_address TEXT NOT NULL,
  creator_public_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'verified', 'failed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMP,
  transaction_id TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  proof_data TEXT
);

CREATE INDEX idx_status ON authenticity_records(status);
CREATE INDEX idx_token_owner ON authenticity_records(token_owner_address);
CREATE INDEX idx_created_at ON authenticity_records(created_at);
```

### 2.2 Database Connection
Create `src/db/database.ts`:
```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export class DatabaseConnection {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.db = new Database(dbPath, {
      verbose: console.log,
      fileMustExist: false
    });
    
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('foreign_keys = ON');
    
    this.runMigrations();
  }

  private runMigrations() {
    const migrationPath = path.join(__dirname, 'migrations', '001_initial_schema.sql');
    const migration = fs.readFileSync(migrationPath, 'utf-8');
    this.db.exec(migration);
  }

  getDb() {
    return this.db;
  }

  close() {
    this.db.close();
  }
}
```

### 2.3 Repository Pattern
Create `src/db/repositories/authenticity.repository.ts`:
```typescript
import { Database } from 'better-sqlite3';
import { AuthenticityRecord } from '../../types';

export class AuthenticityRepository {
  constructor(private db: Database) {}

  async insertPendingRecord(record: {
    sha256Hash: string;
    tokenOwnerAddress: string;
    creatorPublicKey: string;
    signature: string;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO authenticity_records 
      (sha256_hash, token_owner_address, creator_public_key, signature, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);
    
    stmt.run(
      record.sha256Hash,
      record.tokenOwnerAddress,
      record.creatorPublicKey,
      record.signature
    );
  }

  async checkExistingImage(sha256Hash: string): Promise<{
    exists: boolean;
    tokenOwnerAddress?: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT token_owner_address 
      FROM authenticity_records 
      WHERE sha256_hash = ?
    `);
    
    const result = stmt.get(sha256Hash) as any;
    
    return {
      exists: !!result,
      tokenOwnerAddress: result?.token_owner_address
    };
  }

  async updateRecordStatus(
    sha256Hash: string,
    status: 'verified' | 'failed',
    transactionId?: string,
    errorMessage?: string
  ): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE authenticity_records 
      SET status = ?, 
          verified_at = CASE WHEN ? = 'verified' THEN datetime('now') ELSE NULL END,
          transaction_id = ?,
          error_message = ?
      WHERE sha256_hash = ?
    `);
    
    stmt.run(status, status, transactionId || null, errorMessage || null, sha256Hash);
  }

  async getRecordByHash(sha256Hash: string): Promise<AuthenticityRecord | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM authenticity_records WHERE sha256_hash = ?
    `);
    
    return stmt.get(sha256Hash) as AuthenticityRecord | null;
  }
}
```

## Phase 3: Image Processing Services (Days 3-4)

### 3.1 Image Hashing Service
Create `src/services/image/hashing.service.ts`:
```typescript
import crypto from 'crypto';
import { Field } from 'o1js';

export class HashingService {
  /**
   * Compute SHA256 hash of image buffer
   */
  computeSHA256(imageBuffer: Buffer): string {
    return crypto.createHash('sha256').update(imageBuffer).digest('hex');
  }

  /**
   * Convert SHA256 hex string to Field for zkApp
   */
  sha256ToField(sha256Hash: string): Field {
    // Convert hex string to BigInt then to Field
    const hashBigInt = BigInt('0x' + sha256Hash);
    return Field(hashBigInt);
  }

  /**
   * Compute Poseidon hash for on-chain storage
   */
  computePoseidonHash(field: Field): Field {
    // This will be implemented using o1js Poseidon
    // Placeholder for actual implementation
    return field;
  }
}
```

### 3.2 Image Verification Service
Create `src/services/image/verification.service.ts`:
```typescript
import { prepareImageVerification, hashImageOffCircuit } from 'authenticity-zkapp';
import { Signature, PublicKey, Field } from 'o1js';

export class VerificationService {
  /**
   * Prepare image for verification and extract SHA256 state
   */
  prepareForVerification(imagePath: string) {
    return prepareImageVerification(imagePath);
  }

  /**
   * Verify signature matches the image hash
   */
  verifySignature(
    signature: Signature,
    expectedHash: Field,
    publicKey: PublicKey
  ): boolean {
    // Verify the signature outside the circuit for performance
    return signature.verify(publicKey, expectedHash.toFields()).toBoolean();
  }

  /**
   * Generate random token owner address
   */
  generateTokenOwnerAddress(): string {
    // Generate a random Mina address for token ownership
    const { PrivateKey } = require('o1js');
    const randomKey = PrivateKey.random();
    return randomKey.toPublicKey().toBase58();
  }
}
```

## Phase 4: Upload Handler Implementation (Day 4)

### 4.1 Upload Handler
Create `src/handlers/upload.handler.ts`:
```typescript
import { Request, Response } from 'express';
import { HashingService } from '../services/image/hashing.service';
import { VerificationService } from '../services/image/verification.service';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository';
import { ProofQueueService } from '../services/queue/proofQueue.service';
import fs from 'fs';
import path from 'path';

export class UploadHandler {
  constructor(
    private hashingService: HashingService,
    private verificationService: VerificationService,
    private repository: AuthenticityRepository,
    private queueService: ProofQueueService
  ) {}

  async handleUpload(req: Request, res: Response) {
    try {
      // Extract from multipart form data
      const { file } = req;
      const { publicKey, signature } = req.body;

      if (!file || !publicKey || !signature) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required fields'
          }
        });
      }

      // Convert image to bytes and compute SHA256
      const imageBuffer = fs.readFileSync(file.path);
      const sha256Hash = this.hashingService.computeSHA256(imageBuffer);

      // Check for existing record
      const existing = await this.repository.checkExistingImage(sha256Hash);
      if (existing.exists) {
        return res.json({
          tokenOwnerAddress: existing.tokenOwnerAddress,
          status: 'duplicate'
        });
      }

      // Prepare image verification
      const verificationInputs = this.verificationService.prepareForVerification(file.path);
      
      // Verify signature matches expected hash
      const { Signature, PublicKey } = require('o1js');
      const sig = Signature.fromBase58(signature);
      const pubKey = PublicKey.fromBase58(publicKey);
      
      const isValid = this.verificationService.verifySignature(
        sig,
        verificationInputs.expectedHash,
        pubKey
      );

      if (!isValid) {
        return res.status(400).json({
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Signature does not match image hash'
          }
        });
      }

      // Generate random token owner address
      const tokenOwnerAddress = this.verificationService.generateTokenOwnerAddress();

      // Insert pending record
      await this.repository.insertPendingRecord({
        sha256Hash,
        tokenOwnerAddress,
        creatorPublicKey: publicKey,
        signature
      });

      // Queue proof generation task
      await this.queueService.enqueueProofGeneration({
        sha256Hash,
        tokenOwnerAddress,
        publicKey,
        signature,
        verificationInputs,
        imagePath: file.path
      });

      // Clean up uploaded file
      fs.unlinkSync(file.path);

      // Return token owner address immediately
      return res.json({
        tokenOwnerAddress,
        sha256Hash,
        status: 'pending'
      });

    } catch (error) {
      console.error('Upload error:', error);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process upload'
        }
      });
    }
  }
}
```

## Phase 5: ZK Service Integration (Days 5-7)

### 5.1 Proof Generation Service
Create `src/services/zk/proofGeneration.service.ts`:
```typescript
import {
  AuthenticityProgram,
  AuthenticityInputs,
  FinalRoundInputs
} from 'authenticity-zkapp';
import { PublicKey, Signature, Field } from 'o1js';

export class ProofGenerationService {
  private compiled = false;

  async compile() {
    if (!this.compiled) {
      console.log('Compiling AuthenticityProgram...');
      await AuthenticityProgram.compile();
      this.compiled = true;
      console.log('AuthenticityProgram compiled successfully');
    }
  }

  async generateProof(task: {
    publicKey: string;
    signature: string;
    verificationInputs: any;
  }) {
    // Ensure program is compiled
    await this.compile();

    // Parse inputs
    const pubKey = PublicKey.fromBase58(task.publicKey);
    const sig = Signature.fromBase58(task.signature);

    // Create public inputs
    const publicInputs = new AuthenticityInputs({
      commitment: task.verificationInputs.expectedHash,
      signature: sig,
      publicKey: pubKey
    });

    // Create private inputs (SHA256 state from round 62)
    const privateInputs = new FinalRoundInputs({
      state: task.verificationInputs.penultimateState,
      initialState: task.verificationInputs.initialState,
      messageWord: task.verificationInputs.messageWord,
      roundConstant: task.verificationInputs.roundConstant
    });

    // Generate proof
    console.log('Generating authenticity proof...');
    const { proof } = await AuthenticityProgram.verifyAuthenticity(
      publicInputs,
      privateInputs
    );

    console.log('Proof generated successfully');
    return { proof, publicInputs };
  }
}
```

### 5.2 Proof Publishing Service
Create `src/services/zk/proofPublishing.service.ts`:
```typescript
import { AuthenticityZkApp } from 'authenticity-zkapp';
import { Mina, PublicKey, PrivateKey, AccountUpdate } from 'o1js';

export class ProofPublishingService {
  private zkApp: AuthenticityZkApp;
  private compiled = false;

  constructor(
    private zkAppAddress: string,
    private deployerKey: string,
    private feePayerKey: string
  ) {
    const zkAppPublicKey = PublicKey.fromBase58(this.zkAppAddress);
    this.zkApp = new AuthenticityZkApp(zkAppPublicKey);
  }

  async compile() {
    if (!this.compiled) {
      console.log('Compiling AuthenticityZkApp...');
      await AuthenticityZkApp.compile();
      this.compiled = true;
      console.log('AuthenticityZkApp compiled successfully');
    }
  }

  async publishProof(
    proof: any,
    publicInputs: any,
    tokenOwnerAddress: string,
    creatorPublicKey: string
  ) {
    await this.compile();

    const tokenOwner = PublicKey.fromBase58(tokenOwnerAddress);
    const creator = PublicKey.fromBase58(creatorPublicKey);
    const feePayer = PrivateKey.fromBase58(this.feePayerKey);

    console.log('Publishing proof to blockchain...');
    
    const txn = await Mina.transaction(
      feePayer.toPublicKey(),
      async () => {
        AccountUpdate.fundNewAccount(feePayer.toPublicKey());
        await this.zkApp.verifyAndStore(
          tokenOwner,
          creator,
          proof,
          publicInputs
        );
      }
    );

    await txn.prove();
    const pendingTxn = await txn.sign([feePayer]).send();

    console.log('Transaction sent:', pendingTxn.hash);
    
    // Wait for confirmation
    await pendingTxn.wait();
    
    return pendingTxn.hash;
  }
}
```

### 5.3 zkApp Interaction Service
Create `src/services/zk/zkAppInteraction.service.ts`:
```typescript
import { Mina, PublicKey, Field } from 'o1js';

export class ZkAppInteractionService {
  constructor(private network: string) {
    this.setupNetwork();
  }

  private setupNetwork() {
    if (this.network === 'testnet') {
      const Berkeley = Mina.Network(
        'https://api.minascan.io/node/devnet/v1/graphql'
      );
      Mina.setActiveInstance(Berkeley);
    } else {
      // Local blockchain for development
      const Local = Mina.LocalBlockchain({ proofsEnabled: true });
      Mina.setActiveInstance(Local);
    }
  }

  async getTokenAccountState(
    tokenOwnerAddress: string,
    tokenId: Field
  ) {
    const tokenOwner = PublicKey.fromBase58(tokenOwnerAddress);
    const account = Mina.getAccount(tokenOwner, tokenId);
    
    return {
      commitment: account.zkapp?.appState[0],
      creatorX: account.zkapp?.appState[1],
      creatorIsOdd: account.zkapp?.appState[2]
    };
  }

  reconstructCreatorPublicKey(
    creatorX: Field,
    creatorIsOdd: Field
  ): PublicKey {
    return PublicKey.from({
      x: creatorX,
      isOdd: creatorIsOdd.equals(Field(1)).toBoolean()
    });
  }
}
```

## Phase 6: Queue Implementation (Day 8)

### 6.1 Queue Service
Create `src/services/queue/proofQueue.service.ts`:
```typescript
interface QueueTask {
  id: string;
  type: 'generate_proof' | 'publish_proof';
  payload: any;
  attempts: number;
  createdAt: Date;
}

export class ProofQueueService {
  private queue: QueueTask[] = [];
  private processing = false;

  async enqueueProofGeneration(payload: any): Promise<string> {
    const task: QueueTask = {
      id: crypto.randomUUID(),
      type: 'generate_proof',
      payload,
      attempts: 0,
      createdAt: new Date()
    };

    this.queue.push(task);
    this.processQueue(); // Start processing if not already
    
    return task.id;
  }

  async enqueueProofPublishing(payload: any): Promise<string> {
    const task: QueueTask = {
      id: crypto.randomUUID(),
      type: 'publish_proof',
      payload,
      attempts: 0,
      createdAt: new Date()
    };

    this.queue.push(task);
    this.processQueue();
    
    return task.id;
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) continue;

      try {
        if (task.type === 'generate_proof') {
          await this.processProofGeneration(task);
        } else if (task.type === 'publish_proof') {
          await this.processProofPublishing(task);
        }
      } catch (error) {
        console.error(`Task ${task.id} failed:`, error);
        
        task.attempts++;
        if (task.attempts < 3) {
          // Retry with exponential backoff
          setTimeout(() => {
            this.queue.push(task);
            this.processQueue();
          }, Math.pow(2, task.attempts) * 1000);
        }
      }
    }

    this.processing = false;
  }

  private async processProofGeneration(task: QueueTask) {
    // Implementation will call ProofGenerationService
    console.log('Processing proof generation:', task.id);
  }

  private async processProofPublishing(task: QueueTask) {
    // Implementation will call ProofPublishingService
    console.log('Processing proof publishing:', task.id);
  }
}
```

## Phase 7: API Routes (Day 9)

### 7.1 Express Server Setup
Create `src/api/server.ts`:
```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import multer from 'multer';
import { uploadRoutes } from './routes/upload.routes';
import { statusRoutes } from './routes/status.routes';
import { tokenOwnerRoutes } from './routes/tokenOwner.routes';
import { errorMiddleware } from './middleware/error.middleware';

export function createServer() {
  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Routes
  app.use('/api', uploadRoutes);
  app.use('/api', statusRoutes);
  app.use('/api', tokenOwnerRoutes);

  // Error handling
  app.use(errorMiddleware);

  return app;
}
```

### 7.2 Upload Routes
Create `src/api/routes/upload.routes.ts`:
```typescript
import { Router } from 'express';
import multer from 'multer';
import { UploadHandler } from '../../handlers/upload.handler';

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

export function createUploadRoutes(uploadHandler: UploadHandler) {
  const router = Router();

  router.post(
    '/upload',
    upload.single('image'),
    (req, res) => uploadHandler.handleUpload(req, res)
  );

  return router;
}
```

### 7.3 Status Routes
Create `src/api/routes/status.routes.ts`:
```typescript
import { Router } from 'express';
import { StatusHandler } from '../../handlers/status.handler';

export function createStatusRoutes(statusHandler: StatusHandler) {
  const router = Router();

  router.get(
    '/status/:sha256Hash',
    (req, res) => statusHandler.getStatus(req, res)
  );

  return router;
}
```

### 7.4 Token Owner Routes
Create `src/api/routes/tokenOwner.routes.ts`:
```typescript
import { Router } from 'express';
import { TokenOwnerHandler } from '../../handlers/tokenOwner.handler';

export function createTokenOwnerRoutes(tokenOwnerHandler: TokenOwnerHandler) {
  const router = Router();

  router.get(
    '/token-owner/:sha256Hash',
    (req, res) => tokenOwnerHandler.getTokenOwner(req, res)
  );

  return router;
}
```

## Phase 8: Main Application (Day 10)

### 8.1 Application Entry Point
Create `src/index.ts`:
```typescript
import dotenv from 'dotenv';
import { createServer } from './api/server';
import { DatabaseConnection } from './db/database';
import { AuthenticityRepository } from './db/repositories/authenticity.repository';
import { HashingService } from './services/image/hashing.service';
import { VerificationService } from './services/image/verification.service';
import { ProofGenerationService } from './services/zk/proofGeneration.service';
import { ProofPublishingService } from './services/zk/proofPublishing.service';
import { ProofQueueService } from './services/queue/proofQueue.service';
import { UploadHandler } from './handlers/upload.handler';
import { StatusHandler } from './handlers/status.handler';
import { TokenOwnerHandler } from './handlers/tokenOwner.handler';

// Load environment variables
dotenv.config();

async function main() {
  console.log('Starting Provenance Backend...');

  // Initialize database
  const dbConnection = new DatabaseConnection(
    process.env.DATABASE_PATH || './data/provenance.db'
  );
  const repository = new AuthenticityRepository(dbConnection.getDb());

  // Initialize services
  const hashingService = new HashingService();
  const verificationService = new VerificationService();
  const proofGenerationService = new ProofGenerationService();
  const proofPublishingService = new ProofPublishingService(
    process.env.ZKAPP_ADDRESS!,
    process.env.DEPLOYER_PRIVATE_KEY!,
    process.env.FEE_PAYER_PRIVATE_KEY!
  );
  const queueService = new ProofQueueService();

  // Initialize handlers
  const uploadHandler = new UploadHandler(
    hashingService,
    verificationService,
    repository,
    queueService
  );
  const statusHandler = new StatusHandler(repository);
  const tokenOwnerHandler = new TokenOwnerHandler(repository);

  // Create and start server
  const app = createServer();
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Network: ${process.env.MINA_NETWORK || 'local'}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    dbConnection.close();
    process.exit(0);
  });
}

main().catch(console.error);
```

## Phase 9: Testing (Day 11)

### 9.1 Unit Test Example
Create `tests/unit/hashing.service.test.ts`:
```typescript
import { HashingService } from '../../src/services/image/hashing.service';
import { describe, it, expect } from '@jest/globals';

describe('HashingService', () => {
  const hashingService = new HashingService();

  it('should compute SHA256 hash correctly', () => {
    const buffer = Buffer.from('test data');
    const hash = hashingService.computeSHA256(buffer);
    
    expect(hash).toBe('39a870a194a787550b6b5d1f49629236');
    expect(hash).toHaveLength(64);
  });

  it('should convert SHA256 to Field', () => {
    const hash = '39a870a194a787550b6b5d1f49629236';
    const field = hashingService.sha256ToField(hash);
    
    expect(field).toBeDefined();
  });
});
```

### 9.2 Integration Test Example
Create `tests/integration/upload.test.ts`:
```typescript
import request from 'supertest';
import { createServer } from '../../src/api/server';
import fs from 'fs';
import path from 'path';

describe('Upload API', () => {
  const app = createServer();

  it('should upload image successfully', async () => {
    const imagePath = path.join(__dirname, 'test-image.jpg');
    
    const response = await request(app)
      .post('/api/upload')
      .attach('image', imagePath)
      .field('publicKey', 'B62...')
      .field('signature', '...');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('tokenOwnerAddress');
    expect(response.body.status).toBe('pending');
  });

  it('should reject invalid file types', async () => {
    const response = await request(app)
      .post('/api/upload')
      .attach('image', 'test.txt')
      .field('publicKey', 'B62...')
      .field('signature', '...');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
```

## Phase 10: Deployment (Day 12)

### 10.1 zkApp Deployment Script
Create `scripts/deploy-zkapp.ts`:
```typescript
import { Mina, PrivateKey, AccountUpdate } from 'o1js';
import { AuthenticityZkApp } from 'authenticity-zkapp';

async function deployZkApp() {
  console.log('Deploying AuthenticityZkApp...');

  // Connect to network
  const Berkeley = Mina.Network(
    'https://api.minascan.io/node/devnet/v1/graphql'
  );
  Mina.setActiveInstance(Berkeley);

  // Load keys
  const deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_PRIVATE_KEY!);
  const zkAppKey = PrivateKey.random();

  // Compile contract
  await AuthenticityZkApp.compile();

  // Deploy
  const zkApp = new AuthenticityZkApp(zkAppKey.toPublicKey());
  
  const txn = await Mina.transaction(deployerKey.toPublicKey(), async () => {
    AccountUpdate.fundNewAccount(deployerKey.toPublicKey());
    await zkApp.deploy();
  });

  await txn.prove();
  await txn.sign([deployerKey, zkAppKey]).send();

  console.log('zkApp deployed at:', zkAppKey.toPublicKey().toBase58());
  console.log('Save this address in your .env as ZKAPP_ADDRESS');
}

deployZkApp().catch(console.error);
```

### 10.2 Production Configuration
Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_PATH=/data/provenance.db
      - MINA_NETWORK=testnet
    volumes:
      - ./data:/data
      - ./cache:/cache
    restart: unless-stopped
```

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

## Monitoring & Maintenance

### Health Check Endpoint
Add to `src/api/server.ts`:
```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
```

### Logging Configuration
Create `src/utils/logger.ts`:
```typescript
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});
```

## Key Implementation Notes

1. **Circuit Compilation**: Compile zkProgram and zkApp once at startup and cache the result
2. **Error Handling**: Implement exponential backoff for retries
3. **Database Transactions**: Use transactions for multi-step operations
4. **File Cleanup**: Always clean up uploaded files after processing
5. **Type Safety**: Use TypeScript strict mode and proper type definitions
6. **Security**: Validate all inputs, use parameterized queries, sanitize file uploads
7. **Performance**: Use connection pooling, implement caching where appropriate
8. **Monitoring**: Log all errors, track proof generation times, monitor queue depth

## Success Checklist

- [ ] All API endpoints return correct response formats
- [ ] Upload flow generates token owner address immediately
- [ ] Proof generation completes within 30 seconds
- [ ] Database properly tracks status transitions
- [ ] Error handling covers all edge cases
- [ ] Integration tests pass for all endpoints
- [ ] zkApp successfully deployed to testnet
- [ ] Documentation complete and up-to-date
- [ ] Monitoring and logging configured
- [ ] Production deployment successful

## Next Steps After Implementation

1. **Performance Optimization**
   - Implement Redis for queue management
   - Add circuit compilation caching
   - Optimize database queries

2. **Scalability**
   - Implement horizontal scaling for workers
   - Add load balancing
   - Consider microservices architecture

3. **Security Hardening**
   - Add rate limiting
   - Implement API authentication
   - Add input sanitization layers

4. **Feature Enhancements**
   - Add batch upload support
   - Implement proof verification caching
   - Add analytics dashboard