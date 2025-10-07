# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Development
```bash
# Prerequisites: Start infrastructure services
docker-compose up -d  # Starts PostgreSQL, pgweb, MinIO, Grafana, Loki, Promtail

# Requirements: Node.js >=20.0.0, npm >=10.0.0

# Access tools
# pgweb: http://localhost:8081 (database UI, no login required)
# MinIO: http://localhost:9001 (admin/minioadmin)
# Grafana: http://localhost:3001 (admin/admin)

# Run services (in separate terminals):
npm run dev:api         # Start API server with hot reload (port 3000)
npm run dev:worker      # Start proof generation worker with hot reload  
npm run dev:monitoring  # Start blockchain monitoring worker with hot reload

# Production commands:
npm run build           # Build TypeScript to dist/
npm run start           # Run migrations, compile zkApp, start API
npm run start:api       # Run migrations and start API server
npm run start:worker    # Compile zkApp and start proof generation worker
npm run start:monitoring # Start blockchain monitoring worker

# MinIO bucket setup (first time only):
docker-compose exec minio mc alias set local http://minio:9000 minioadmin minioadmin
docker-compose exec minio mc mb local/authenticity --ignore-existing
# Alternative for local development:
docker-compose exec minio mc mb /data/authenticity-local
```

### Database Management
```bash
npm run db:migrate      # Run database migrations
npm run db:reset        # Reset database (removes volumes, restarts containers, runs migrations)

# Knex migration commands (use npx):
npx knex migrate:rollback  # Rollback last migration
npx knex migrate:make migration_name  # Create new migration file

# Direct PostgreSQL access
docker-compose exec postgres psql -U postgres authenticity_dev

# Manual database reset
docker-compose down -v  # Remove volumes
docker-compose up -d    # Restart containers
npm run db:migrate      # Rerun migrations
```

### Testing & Code Quality
```bash
npm run test:unit                # Run unit tests only (excludes integration)
npm run test:integration         # Run integration tests with test database (uses scripts/test-integration.sh)
npm run test:integration:local   # Run integration tests directly with vitest (local mode)
npm run lint                     # Run ESLint
npm run format                   # Format code with Prettier

# Pre-commit hooks (Husky + lint-staged):
# - Automatically runs ESLint with auto-fix
# - Runs Prettier formatting
# - Builds TypeScript to check for compilation errors
# - For admin-dashboard: runs TypeScript check and linting

# Manual testing scripts
IMAGE_PATH=./image.png API_URL=http://localhost:3000 tsx test-upload.mts
tsx test-admin.mts stats              # Queue statistics
tsx test-admin.mts failed             # List failed jobs
tsx test-admin.mts details <jobId>    # Job details
tsx test-admin.mts retry <jobId>      # Retry job

# MinIO testing script
tsx test-minio.mts      # Test MinIO connectivity and operations
```

### Observability
```bash
# Start observability stack
docker-compose up -d loki grafana promtail

# Access dashboards
# Grafana: http://localhost:3001 (admin/admin)
# Loki API: http://localhost:3100

# View logs in Grafana
# 1. Navigate to http://localhost:3001
# 2. Login with admin/admin
# 3. Go to Explore → Select Loki datasource
# 4. Query examples:
#    {service="api"} - All API logs
#    {service="worker"} - All Worker logs
#    {service=~"api|worker"} |= "error" - All errors
#    {service="api"} |= "correlationId=<id>" - Track request through system
```

## High-Level Architecture

TouchGrass MVP: A social photo challenge platform with zero-knowledge proof verification on Mina Protocol. Users participate in daily challenges by submitting photos that are cryptographically verified for authenticity.

The system includes both a backend API and an admin dashboard (Next.js app) for managing challenges, users, job queues, and submissions.

### Core Flow
1. **Upload**: Client uploads image with cryptographic signature
2. **Queue**: Upload handler enqueues proof generation job in pg-boss
3. **Process**: Worker service processes jobs asynchronously
4. **Prove**: Worker generates zero-knowledge proofs using o1js
5. **Publish**: Worker publishes proofs to Mina blockchain
6. **Verify**: Anyone can verify authenticity via token owner address

### Service Architecture

```
Client → REST API → Handlers → Services → Database
                         ↓
                    Job Queue → Worker → Blockchain
```

### Architectural Patterns

**Dependency Injection Architecture**: All components use constructor-based dependency injection for testability and flexibility. Handlers receive services via constructors, not imports.

**Instance-Based Adapters**: PostgresAdapter uses instance methods (not static) to enable proper dependency injection and connection pooling.

**Context Propagation**: AsyncLocalStorage propagates correlation IDs through async operations, from HTTP requests through job queue to worker processing.

**Comprehensive Error Handling**: Upload failures trigger cleanup of temp files, database records, and MinIO storage. Handlers validate inputs and provide field-specific error responses.

## Project Structure

```
src/
├── api/
│   ├── middleware/      # Security, logging, error handling, context propagation
│   ├── routes/          # Express route definitions
│   └── server.ts        # Express server setup
├── config/
│   └── index.ts         # Environment validation & singleton configuration
├── db/
│   ├── adapters/
│   │   └── PostgresAdapter.ts  # Instance-based Knex wrapper with connection pooling
│   ├── repositories/
│   │   └── authenticity.repository.ts  # Repository pattern with camelCase/snake_case mapping
│   ├── database.ts      # Database connection manager
│   └── types.ts         # Database type definitions
├── handlers/            # Request handlers with dependency injection
│   ├── upload.handler.ts    # Complex validation, orchestration, error recovery
│   ├── status.handler.ts    # Simple status queries
│   ├── tokenOwner.handler.ts
│   ├── admin.handler.ts     # Job queue management
│   └── challenges.handler.ts # TouchGrass challenge endpoints
├── services/
│   ├── blockchain/
│   │   ├── archiveNode.service.ts   # Mina archive node GraphQL queries
│   │   ├── minaNode.service.ts      # Mina node queries using o1js fetchLastBlock
│   │   └── monitoring.service.ts    # Transaction status aggregation and logging
│   ├── image/
│   │   └── verification.service.ts  # SHA256 hashing, signature verification using o1js
│   ├── queue/
│   │   └── jobQueue.service.ts      # pg-boss wrapper with singleton keys, retry logic
│   ├── storage/
│   │   └── storageService.ts        # MinIO S3-compatible storage abstraction
│   └── zk/
│       ├── proofGeneration.service.ts  # ZK proof generation with o1js circuits
│       └── proofPublishing.service.ts  # Mina blockchain publishing
├── utils/
│   ├── logger.ts        # Pino logger with correlation IDs
│   └── performance.ts   # Performance tracking utilities
├── workers/
│   ├── proofGenerationWorker.ts    # Proof generation job processor 
│   └── blockchainMonitorWorker.ts  # Blockchain monitoring job processor
├── index.ts             # API server entry point with dependency wiring
├── worker.ts            # Proof generation worker service entry point
└── monitoringWorker.ts  # Blockchain monitoring worker service entry point

admin-dashboard/         # Next.js admin interface
├── app/                # App router pages (jobs, challenges, users, chains)
├── components/         # Reusable UI components
├── lib/               # API client and types
└── middleware.ts      # Next.js middleware

migrations/              # Knex database migrations
test/                    # Unit tests with Vitest
├── handlers/           # Handler tests with mocked services
├── repositories/       # Repository tests
└── services/           # Service tests
```

## Key Components

### Handlers
- **UploadHandler**: Validates uploads, creates records, enqueues jobs, handles comprehensive error recovery
- **StatusHandler**: Returns proof generation/publishing status
- **TokenOwnerHandler**: Returns token owner for verified images
- **AdminHandler**: Job queue management (stats, failures, retries)
- **ChallengesHandler**: TouchGrass challenge endpoints (current challenge, challenge metadata)

### Services
- **ImageAuthenticityService**: SHA256 hashing, signature verification using o1js and authenticity-zkapp
- **StorageService**: MinIO S3-compatible storage for cross-container file sharing
- **ProofGenerationService**: Generates ZK proofs using o1js circuits
- **ProofPublishingService**: Publishes proofs to Mina blockchain
- **JobQueueService**: pg-boss wrapper with singleton keys to prevent duplicates
- **ArchiveNodeService**: Queries Mina archive node for transaction status via GraphQL
- **MinaNodeService**: Queries Mina node for block height using o1js fetchLastBlock
- **BlockchainMonitoringService**: Aggregates and logs transaction status (pending/included/final/abandoned)

### Database
- **PostgresAdapter**: Instance-based Knex wrapper (NOT static methods) with connection pooling
- **AuthenticityRepository**: Repository pattern for data access with camelCase/snake_case transformation
- **ChallengesRepository**: TouchGrass challenges data access
- **Migrations**: Schema managed via Knex migrations
- **Status values**: `pending`, `processing`, `verified`, `failed`

### Workers
- **ProofGenerationWorker**: Processes proof generation jobs from pg-boss queue with context propagation
  - Updates status throughout lifecycle
  - Handles retries (3 attempts with exponential backoff)
  - Downloads images from MinIO, generates proofs, publishes to blockchain
  - Cleans up temporary files and MinIO storage after processing
- **BlockchainMonitorWorker**: Lightweight monitoring service for transaction status
  - Queries Mina archive node every 5 minutes to track transaction status
  - Logs transaction categorization (pending/included/final/abandoned)
  - Independent deployment with minimal resource requirements

## API Endpoints

### Public Endpoints
- `POST /api/upload` - Upload image for proof generation
  - Multipart form: `image` file, `signature`, `publicKey`
  - Returns: `{ sha256Hash, tokenOwnerAddress, status }`
  - Async proof generation via job queue

- `GET /api/status/:sha256Hash` - Check proof status
  - Returns: `{ status, transactionId?, tokenOwner? }`
  - Status: `pending` | `processing` | `verified` | `failed`

- `GET /api/token-owner/:sha256Hash` - Get token owner
  - Returns: `{ tokenOwner }` if verified

- `GET /api/challenges/current` - Get current active challenge
  - Returns: TouchGrass challenge metadata

- `GET /health` - Health check
- `GET /api/version` - API version

### Admin Endpoints (dev mode or with ADMIN_API_KEY)
- `GET /api/admin/jobs/stats` - Queue statistics
- `GET /api/admin/jobs/failed?limit=10&offset=0` - Failed jobs with pagination
- `GET /api/admin/jobs/:jobId` - Job details
- `POST /api/admin/jobs/:jobId/retry` - Retry failed job

## Environment Configuration

### Required Variables
```bash
DATABASE_URL=postgresql://user:pass@host:5432/db
MINA_NETWORK=testnet|mainnet
ZKAPP_ADDRESS=<deployed_zkapp_address>
FEE_PAYER_PRIVATE_KEY=<private_key>
PORT=3000
NODE_ENV=development|production|test
CORS_ORIGIN=http://localhost:3001
UPLOAD_MAX_SIZE=10485760  # 10MB default, configurable

# MinIO Storage Configuration
MINIO_ENDPOINT=http://localhost:9000
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_BUCKET=authenticity
```

### Optional Variables
```bash
CIRCUIT_CACHE_PATH=./cache  # zkApp compilation cache
ADMIN_API_KEY=<api_key>     # Required for admin endpoints in production
SSL_REQUIRED=false          # Enable SSL for PostgreSQL in production

# On-Chain Monitoring Configuration
ARCHIVE_NODE_ENDPOINT=https://api.minascan.io/node/berkeley/v1/graphql  # Default for testnet
MINA_NODE_ENDPOINT=https://api.minascan.io/node/berkeley/v1/graphql     # Default for testnet
MONITORING_ENABLED=true     # Enable blockchain transaction monitoring (default: true)
```

## Implementation Details

### Job Queue (pg-boss)
- Queue names: `proof-generation`, `blockchain-monitoring`
- Singleton key prevents duplicate jobs for same hash
- Retry policy: 3 attempts with exponential backoff
- Job retention: 24 hours for auditing
- Jobs carry correlation IDs for distributed tracing
- Worker concurrency: Configurable via pg-boss
- Monitoring job: Runs every 5 minutes to check transaction status on-chain

### Database Schema

#### Core Tables
```sql
-- authenticity_records table
sha256_hash (PK)        -- Image hash
token_owner_address     -- Random address per image
signature               -- Cryptographic signature
public_key              -- Signer's public key
status                  -- pending|processing|verified|failed
transaction_id          -- Mina blockchain transaction
job_id                  -- pg-boss job ID
processing_started_at   -- Processing timestamp
verified_at             -- Verification timestamp
failed_at               -- Failure timestamp
failure_reason          -- Error details
retry_count             -- Retry attempts
created_at              -- Upload timestamp
updated_at              -- Last modified

-- TouchGrass MVP tables (see migrations for full schema)
-- users: wallet_address, created_at
-- challenges: id, title, description, start_time, end_time, active, etc.
-- chains: id, name, challenge_id, created_at, etc.
-- submissions: id, sha256_hash, user_wallet_address, challenge_id, chain_id, tagline, chain_position, etc.
```

### Security & Middleware
- **Helmet.js**: Security headers
- **CORS**: Configurable origins
- **Compression**: Response compression
- **File Upload**: Multer with size limits and file type validation (image/*)
- **Error Handling**: Consistent error responses with AsyncErrorHandler
- **Request Logging**: Pino with correlation IDs
- **AsyncLocalStorage**: Context propagation for request tracing

### zkApp Integration
- **Circuit Compilation**: Pre-compiled at worker startup
- **Cache Directory**: Configurable via CIRCUIT_CACHE_PATH
- **Compilation Time**: 30-60 seconds
- **SHA256 Verification**: Uses penultimate round state for efficiency
- **Token Generation**: Random Field element for each image

### TypeScript Configuration
- Target: ES2022
- Module: NodeNext
- Type: module (ESM)
- Strict mode enabled
- Import extensions: `.js` required for TypeScript files

## Testing Strategy
- **Framework**: Vitest with 30-second timeout for tests
- **Unit Tests**: Located in `test/` directory, organized by layer
- **Mocking**: Services mocked at boundaries using vitest-mock-extended
- **Manual Testing**: Scripts for upload (`test-upload.mts`) and admin (`test-admin.mts`) operations
- **Test Pattern**: Tests focus on validation, error conditions, and domain logic

## Deployment

### Railway Configuration
- **API Service**: Lightweight (512MB RAM), 2 replicas
- **Worker Service**: Heavy (2GB RAM for proof generation), 2 replicas
- **Monitoring Service**: Lightweight (512MB RAM), 1 replica for blockchain monitoring
- **MinIO Service**: S3-compatible storage for image files
- **Health Checks**: 180s timeout, 3 restart attempts
- **Auto-migrations**: Run at API startup
- **Circuit Compilation**: At proof generation worker startup
- **Graceful Shutdown**: Signal handling for clean termination

### Railway CLI
```bash
# Install and setup
npm install -g @railway/cli
railway login
railway link  # Select project/environment

# Switch environments
railway environment staging
railway environment production

# Connect to database
railway connect postgres

# View logs
railway logs --service api
railway logs --service worker
railway logs -f  # Tail logs
```

### Docker Setup
```yaml
services:
  postgres:    # Port 5432, health checks enabled
  pgweb:       # Port 8081, auto-connects to postgres
  minio:       # Port 9000 (API), 9001 (Console)
  grafana:     # Port 3001, admin/admin
  loki:        # Port 3100, log aggregation
  promtail:    # Log collection from ./logs/*.log
```

## Local Development Setup

1. **Start infrastructure**: `docker-compose up -d`
2. **Configure environment**: `cp .env.example .env`
3. **Setup MinIO bucket** (first time only):
   ```bash
   docker-compose exec minio mc alias set local http://minio:9000 minioadmin minioadmin
   docker-compose exec minio mc mb local/authenticity --ignore-existing
   ```
4. **Run migrations**: `npm run db:migrate`
5. **Start services**:
   - Terminal 1: `npm run dev:api`
   - Terminal 2: `npm run dev:worker`
   - Terminal 3: `npm run dev:monitoring` (optional, for blockchain monitoring)
6. **Access tools**:
   - API: http://localhost:3000
   - pgweb: http://localhost:8081
   - MinIO: http://localhost:9001
   - Grafana: http://localhost:3001

### Admin Dashboard Development
```bash
# In admin-dashboard directory:
cd admin-dashboard
npm install
npm run dev          # Start admin dashboard on port 3000 (default Next.js port)

# Admin dashboard commands:
npm run build        # Build for production
npm run precommit    # TypeScript check and linting (used by main project pre-commit)
```

## Common Issues & Solutions

1. **Database connection**: Ensure PostgreSQL is running via Docker
2. **Circuit compilation**: Allow 30-60 seconds for initial compilation
3. **Job failures**: Check worker logs and admin endpoints
4. **MinIO connectivity**: Ensure MinIO is running and bucket exists
5. **Memory issues**: Worker requires 2GB+ RAM for proof generation
6. **File uploads**: Check file size limits (default 10MB) and type validation

## Important Notes

- **No SQLite support**: PostgreSQL-only (required for pg-boss)
- **Instance-based adapters**: PostgresAdapter uses instance methods, not static
- **Dependency injection**: All handlers and services use constructor injection
- **Context propagation**: Correlation IDs flow through AsyncLocalStorage
- **Cache directory**: Auto-created when needed, in `.gitignore`
- **Logging**: Structured JSON logs with correlation IDs for request tracing
- **File outputs**: Logs written to `./logs/*.log` for Promtail collection
- **File storage**: MinIO required for cross-container file sharing between API and Worker
- **TypeScript imports**: Always use `.js` extension when importing TypeScript files
- **TouchGrass MVP**: Currently implementing social challenge features (see mvp.md)
- **Error type pattern**: Uses ApiError class with specific error codes and field validation