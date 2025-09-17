# Test Framework Implementation Plan

## Current Status: Phase 1 Complete ✅
- **Phase 1 Setup**: Completed on 2025-09-17
- **Test Framework**: Vitest installed with minimal configuration
- **Current Structure**: 1 test file, 1 config file, 1 npm script
- **Tests Passing**: 3 basic tests in example.test.ts

## Overview
This document provides a step-by-step plan to implement a modern, uncomplicated test framework for the Authenticity Backend API. The approach prioritizes simplicity, maintainability, and follows Node.js API testing best practices.

## Core Philosophy: Minimal Incremental Approach
**IMPORTANT**: Each phase should implement the absolute minimum needed to achieve its goals.

### Principles:
1. **Start with the bare minimum** - Only add what's immediately needed
2. **No premature structure** - Don't create folders/files until they're used
3. **No placeholder code** - Every line should serve a current purpose
4. **Add complexity only when required** - Let actual needs drive the architecture
5. **One test proves the setup** - Don't write multiple tests just to have them

### What This Means in Practice:
- Phase 1: Just prove tests can run (1 config file, 1 test file, 1 script)
- Phase 2: Add only the unit tests that test real code
- Phase 3: Add containers only when testing database/storage
- Phase 4: Add CI/CD only when tests provide value

This approach ensures we never have unused code, empty folders, or placeholder configurations.

## Testing Strategy

### Test Types
1. **Unit Tests**: Test individual services and utilities in isolation
2. **Integration Tests**: Test API endpoints with real database connections
3. **Contract Tests**: Validate API responses match expected schemas

### Framework Selection
- **Test Runner**: Vitest (fast, ESM-native, Jest-compatible)
- **Assertion Library**: Built-in Vitest assertions
- **HTTP Testing**: Supertest
- **Database**: Test containers for PostgreSQL isolation
- **Mocking**: Vitest built-in mocks

## Implementation Steps

### Step 1: Install Dependencies ✅ COMPLETED

```bash
npm install --save-dev vitest @vitest/ui supertest @types/supertest
npm install --save-dev @testcontainers/postgresql testcontainers
npm install --save-dev vitest-mock-extended
```

### Step 2: Configure Vitest ✅ COMPLETED

Created `vitest.config.ts` (simplified version):

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
  },
});
```

**Note**: Simplified configuration without setupFiles or complex aliases. Add these when needed for integration tests.

### Step 3: Create Test Setup ⏸️ DEFERRED

**Note**: Test setup with containers deferred until integration tests are needed. For now, basic unit tests run without setup.

```typescript
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import knex, { Knex } from 'knex';
import { Client } from 'minio';
import { config } from 'dotenv';

config({ path: '.env.test' });

let postgresContainer: any;
let minioContainer: StartedTestContainer;
let db: Knex;
let minioClient: Client;

beforeAll(async () => {
  // Start PostgreSQL container
  postgresContainer = await new PostgreSqlContainer()
    .withDatabase('test_db')
    .withUsername('test_user')
    .withPassword('test_pass')
    .start();

  // Start MinIO container
  minioContainer = await new GenericContainer('minio/minio')
    .withExposedPorts(9000)
    .withEnvironment({
      MINIO_ROOT_USER: 'minioadmin',
      MINIO_ROOT_PASSWORD: 'minioadmin',
    })
    .withCommand(['server', '/data'])
    .start();

  // Create database connection
  db = knex({
    client: 'pg',
    connection: postgresContainer.getConnectionUri(),
  });

  // Run migrations
  await db.migrate.latest();

  // Initialize pg-boss tables
  await db.raw(`
    CREATE SCHEMA IF NOT EXISTS pgboss;
  `);

  // Create MinIO client
  const minioPort = minioContainer.getMappedPort(9000);
  minioClient = new Client({
    endPoint: 'localhost',
    port: minioPort,
    useSSL: false,
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
  });

  // Create test bucket
  const bucketName = 'test-authenticity';
  const exists = await minioClient.bucketExists(bucketName);
  if (!exists) {
    await minioClient.makeBucket(bucketName);
  }

  // Set environment variables for tests
  process.env.DATABASE_URL = postgresContainer.getConnectionUri();
  process.env.MINIO_ENDPOINT = `http://localhost:${minioPort}`;
  process.env.MINIO_BUCKET = bucketName;
});

afterAll(async () => {
  // Cleanup
  if (db) await db.destroy();
  if (postgresContainer) await postgresContainer.stop();
  if (minioContainer) await minioContainer.stop();
});

beforeEach(async () => {
  // Clean database between tests
  if (db) {
    await db('authenticity_records').delete();
    // Clean other tables as needed
  }

  // Clean MinIO bucket
  if (minioClient) {
    const bucketName = process.env.MINIO_BUCKET || 'test-authenticity';
    const objectsList = await minioClient.listObjects(bucketName, '', true);
    for await (const obj of objectsList) {
      await minioClient.removeObject(bucketName, obj.name);
    }
  }
});

export { db, minioClient };
```

### Step 4: Create Test Environment File ⏸️ DEFERRED

**Note**: Environment file will be created when needed for integration tests that require specific configuration.

### Step 5: Update Package.json Scripts ✅ COMPLETED

Added single test script to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

**Note**: Additional scripts (watch, coverage) will be added only when actively used.

### Step 6: Create Test Structure ✅ COMPLETED

Minimal structure:
```
test/
└── example.test.ts         # Single test file to verify setup
```

**Note**: Subdirectories (unit/, integration/, helpers/, etc.) will be created only when multiple test files require organization.

## Example Tests

### Unit Test Example

Create `test/unit/services/image.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImageAuthenticityService } from '@/services/image/verification.service';
import { createHash } from 'crypto';

describe('ImageAuthenticityService', () => {
  let service: ImageAuthenticityService;

  beforeEach(() => {
    service = new ImageAuthenticityService();
  });

  describe('calculateHash', () => {
    it('should calculate SHA256 hash of buffer', async () => {
      const buffer = Buffer.from('test data');
      const expectedHash = createHash('sha256').update(buffer).digest('hex');

      const result = await service.calculateHash(buffer);

      expect(result).toBe(expectedHash);
    });

    it('should return consistent hash for same input', async () => {
      const buffer = Buffer.from('test data');

      const hash1 = await service.calculateHash(buffer);
      const hash2 = await service.calculateHash(buffer);

      expect(hash1).toBe(hash2);
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature', async () => {
      // Mock implementation
      const mockSignature = 'valid-signature';
      const mockPublicKey = 'public-key';
      const mockHash = 'hash';

      // Add actual signature verification logic test
      const result = await service.verifySignature(mockSignature, mockPublicKey, mockHash);

      expect(result).toBeDefined();
    });
  });
});
```

### Integration Test Example

Create `test/integration/upload.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { createServer } from '@/api/server';
import { MinioHelper } from '../helpers/minio';
import { minioClient } from '../setup';
import path from 'path';
import fs from 'fs';

describe('POST /api/upload', () => {
  let app: Express;
  let minioHelper: MinioHelper;

  beforeAll(async () => {
    app = await createServer();
    minioHelper = new MinioHelper(minioClient, process.env.MINIO_BUCKET || 'test-authenticity');
  });

  beforeEach(async () => {
    // Clear MinIO bucket before each test
    await minioHelper.clearBucket();
  });

  it('should upload image successfully and store in MinIO', async () => {
    const imagePath = path.join(__dirname, '../fixtures/test-image.png');

    const response = await request(app)
      .post('/api/upload')
      .attach('image', imagePath)
      .field('signature', 'test-signature')
      .field('publicKey', 'test-public-key')
      .expect(200);

    expect(response.body).toHaveProperty('sha256Hash');
    expect(response.body).toHaveProperty('tokenOwnerAddress');
    expect(response.body).toHaveProperty('status', 'pending');

    // Verify file was stored in MinIO
    const fileKey = `uploads/${response.body.sha256Hash}`;
    const exists = await minioHelper.fileExists(fileKey);
    expect(exists).toBe(true);
  });

  it('should reject upload without image', async () => {
    const response = await request(app)
      .post('/api/upload')
      .field('signature', 'test-signature')
      .field('publicKey', 'test-public-key')
      .expect(400);

    expect(response.body).toHaveProperty('error');
  });

  it('should reject non-image files', async () => {
    const textFile = Buffer.from('not an image');

    const response = await request(app)
      .post('/api/upload')
      .attach('image', textFile, 'test.txt')
      .field('signature', 'test-signature')
      .field('publicKey', 'test-public-key')
      .expect(400);

    expect(response.body.error).toContain('image');
  });

  it('should enforce file size limit', async () => {
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB

    const response = await request(app)
      .post('/api/upload')
      .attach('image', largeBuffer, 'large.png')
      .field('signature', 'test-signature')
      .field('publicKey', 'test-public-key')
      .expect(413);

    expect(response.body.error).toContain('size');
  });
});
```

### Test Helper Example

Create `test/helpers/api.ts`:

```typescript
import request from 'supertest';
import { Express } from 'express';

export class ApiHelper {
  constructor(private app: Express) {}

  async uploadImage(data: {
    imagePath: string;
    signature: string;
    publicKey: string;
  }) {
    return request(this.app)
      .post('/api/upload')
      .attach('image', data.imagePath)
      .field('signature', data.signature)
      .field('publicKey', data.publicKey);
  }

  async getStatus(sha256Hash: string) {
    return request(this.app)
      .get(`/api/status/${sha256Hash}`);
  }

  async getTokenOwner(sha256Hash: string) {
    return request(this.app)
      .get(`/api/token-owner/${sha256Hash}`);
  }

  async getAdminStats(apiKey?: string) {
    const req = request(this.app).get('/api/admin/jobs/stats');
    if (apiKey) {
      req.set('x-api-key', apiKey);
    }
    return req;
  }
}
```

### Database Helper Example

Create `test/helpers/db.ts`:

```typescript
import { Knex } from 'knex';

export class DbHelper {
  constructor(private db: Knex) {}

  async createAuthenticityRecord(data: {
    sha256Hash: string;
    tokenOwnerAddress: string;
    signature: string;
    publicKey: string;
    status?: string;
  }) {
    return this.db('authenticity_records').insert({
      sha256_hash: data.sha256Hash,
      token_owner_address: data.tokenOwnerAddress,
      signature: data.signature,
      public_key: data.publicKey,
      status: data.status || 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  async getRecord(sha256Hash: string) {
    return this.db('authenticity_records')
      .where('sha256_hash', sha256Hash)
      .first();
  }

  async cleanDatabase() {
    await this.db('authenticity_records').delete();
  }
}
```

### MinIO Helper Example

Create `test/helpers/minio.ts`:

```typescript
import { Client } from 'minio';
import { Readable } from 'stream';

export class MinioHelper {
  constructor(private client: Client, private bucket: string) {}

  async uploadFile(key: string, content: Buffer | string) {
    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    return this.client.putObject(this.bucket, key, buffer, buffer.length);
  }

  async downloadFile(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch (error) {
      return false;
    }
  }

  async deleteFile(key: string) {
    return this.client.removeObject(this.bucket, key);
  }

  async clearBucket() {
    const objects = await this.client.listObjects(this.bucket, '', true);
    for await (const obj of objects) {
      await this.client.removeObject(this.bucket, obj.name);
    }
  }
}
```

## Mocking Strategy

### Mock pg-boss for Unit Tests

Create `test/helpers/mocks.ts`:

```typescript
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

export function mockPgBoss() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('mock-job-id'),
    work: vi.fn().mockResolvedValue(undefined),
    getJobById: vi.fn().mockResolvedValue({
      id: 'mock-job-id',
      name: 'proof-generation',
      data: {},
      state: 'created',
    }),
  };
}

export function mockMinioClient() {
  return {
    putObject: vi.fn().mockResolvedValue({ etag: 'mock-etag' }),
    getObject: vi.fn().mockResolvedValue(Buffer.from('mock-data')),
    removeObject: vi.fn().mockResolvedValue(undefined),
    bucketExists: vi.fn().mockResolvedValue(true),
    makeBucket: vi.fn().mockResolvedValue(undefined),
    listObjects: vi.fn().mockReturnValue([]),
  };
}

export function mockZkApp() {
  return {
    compile: vi.fn().mockResolvedValue(undefined),
    generateProof: vi.fn().mockResolvedValue({
      proof: 'mock-proof',
      publicInput: 'mock-input',
    }),
    publishProof: vi.fn().mockResolvedValue({
      transactionId: 'mock-tx-id',
    }),
  };
}
```

## CI/CD Integration

### GitHub Actions Workflow

Create `.github/workflows/test.yml`:

```yaml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test_db
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm run test:run
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

## Best Practices

### 1. Test Organization
- Keep tests close to the code they test
- Use descriptive test names that explain the behavior
- Group related tests using `describe` blocks
- Follow AAA pattern: Arrange, Act, Assert

### 2. Test Data
- Use factories for creating test data
- Avoid hardcoding values when possible
- Clean up test data after each test
- Use realistic data that matches production

### 3. Async Testing
- Always await async operations
- Use proper timeout values for long operations
- Handle promise rejections properly
- Test both success and error paths

### 4. Mocking
- Mock external dependencies (APIs, databases, file systems)
- Don't mock what you're testing
- Keep mocks simple and focused
- Update mocks when interfaces change

### 5. Coverage Goals
- Aim for 80% code coverage minimum
- Focus on critical business logic
- Don't chase 100% coverage at the expense of quality
- Exclude generated files and configs from coverage

## Implementation Timeline

### Phase 1: Setup ✅ COMPLETED (2025-09-17)
- ✅ Installed only essential dependencies (vitest, @types/node)
- ✅ Created minimal vitest.config.ts
- ✅ Added single "test" script to package.json
- ✅ Created one example test file
- ✅ Verified tests run successfully

### Phase 2: Unit Tests 🔜 NEXT
**Approach**: Only test actual code that exists. Start with the most critical business logic.
- Create first real test file only when testing actual service
- Add mocking only when needed for that specific test
- Add test helpers only when duplicating code
- No empty test files or placeholder tests

### Phase 3: Integration Tests
**Approach**: Add infrastructure only when testing requires it.
- Set up test containers only when first database test is written
- Add MinIO container only when testing actual file storage
- Create .env.test only with values actually used in tests
- Keep container setup in same file as tests until multiple files need it

**What Integration Tests Should Cover**:
- Full HTTP request/response cycle
- Side effects (file cleanup, database writes)
- Error scenarios with proper cleanup (e.g., fs.unlinkSync on validation failure)
- Transaction rollbacks
- Multi-service orchestration
- Actual file uploads with multipart form data

### Phase 4: Refinement
- Add missing tests
- Improve coverage
- Set up CI/CD
- Documentation

## Common Pitfalls to Avoid

1. **Don't test implementation details** - Test behavior, not internals
2. **Avoid test interdependencies** - Each test should run independently
3. **Don't ignore flaky tests** - Fix them immediately
4. **Avoid excessive mocking** - It can hide real issues
5. **Don't skip error cases** - They're as important as success cases

## Troubleshooting

### Test Container Issues
If test containers fail to start:
```bash
# Check Docker is running
docker ps

# Clear Docker cache
docker system prune -a

# Increase Docker memory allocation
```

### Database Migration Issues
```bash
# Run migrations manually
NODE_ENV=test npx knex migrate:latest

# Check migration status
NODE_ENV=test npx knex migrate:status
```

### Timeout Issues
Increase timeout in `vitest.config.ts`:
```typescript
test: {
  testTimeout: 60000, // 60 seconds
}
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Supertest Documentation](https://github.com/ladjs/supertest)
- [Testcontainers Documentation](https://node.testcontainers.org/)
- [Node.js Testing Best Practices](https://github.com/goldbergyoni/nodebestpractices#4-testing-and-overall-quality-practices)

## Conclusion

This test framework provides a solid foundation for testing the Authenticity Backend API. It prioritizes simplicity while following modern best practices. The setup uses minimal dependencies and avoids complexity, making it easy for new developers to understand and contribute.

Start with Phase 1 and progress through each phase systematically. Focus on testing critical paths first, then expand coverage as needed.