# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Development
```bash
# Prerequisites: Start PostgreSQL and pgweb
docker-compose up -d  # Starts PostgreSQL (port 5432) and pgweb (port 8081)

# Access database UI
# pgweb is available at http://localhost:8081 (no login required)

# Run services (in separate terminals):
npm run dev:api       # Start API server with hot reload (port 3000)
npm run dev:worker    # Start worker service with hot reload

# Production commands:
npm run build         # Build TypeScript to dist/
npm run start         # Run migrations, compile zkApp, start API
npm run start:api     # Run migrations and start API server
npm run start:worker  # Compile zkApp and start worker service
```

### Database Management
```bash
npm run db:migrate      # Run database migrations (development)
npm run db:rollback     # Rollback last migration
npm run db:migrate:make # Create new migration file
npm run db:reset        # Reset database (removes volumes, restarts containers, runs migrations)

# Direct PostgreSQL access
docker-compose exec postgres psql -U postgres authenticity_dev

# Manual database reset
docker-compose down -v  # Remove volumes
docker-compose up -d    # Restart containers
npm run db:migrate      # Rerun migrations
```

### Code Quality
```bash
npm run lint    # Run ESLint on src/**/*.ts
npm run format  # Format code with Prettier
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
```

**Note**: No automated tests are implemented. Testing is done via manual scripts (`test-upload.mts`, `test-admin.mts`).

## High-Level Architecture

Zero-knowledge proof backend for image authenticity verification on Mina Protocol. Users prove image authenticity without revealing sensitive information.

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

## Project Structure

```
src/
├── api/
│   ├── middleware/      # Security, logging, error handling
│   ├── routes/          # Express route definitions
│   └── server.ts        # Express server setup
├── config/
│   └── index.ts         # Environment validation & config
├── db/
│   ├── adapters/
│   │   └── PostgresAdapter.ts  # PostgreSQL wrapper (instance-based)
│   ├── repositories/
│   │   └── authenticity.repository.ts  # Data access layer
│   ├── database.ts      # Database connection manager
│   └── types.ts         # Database type definitions
├── handlers/            # Request handlers (orchestrate services)
│   ├── upload.handler.ts
│   ├── status.handler.ts
│   ├── tokenOwner.handler.ts
│   └── admin.handler.ts
├── services/
│   ├── image/
│   │   └── verification.service.ts  # ImageAuthenticityService
│   ├── queue/
│   │   └── jobQueue.service.ts      # pg-boss integration
│   └── zk/
│       ├── proofGeneration.service.ts
│       └── proofPublishing.service.ts
├── workers/
│   └── proofGenerationWorker.ts    # Background job processor
├── index.ts             # API server entry point
└── worker.ts            # Worker service entry point

migrations/              # Knex database migrations
scripts/                 # Utility scripts
├── compile-zkapp.ts     # Pre-compile zkApp circuits
├── init-db.sql          # Database initialization
test-upload.mts          # Manual upload testing
test-admin.mts           # Manual admin API testing
```

## Key Components

### Handlers
- **UploadHandler**: Validates uploads, creates records, enqueues jobs
- **StatusHandler**: Returns proof generation/publishing status
- **TokenOwnerHandler**: Returns token owner for verified images
- **AdminHandler**: Job queue management (stats, failures, retries)

### Services
- **ImageAuthenticityService**: SHA256 hashing, signature verification
- **ProofGenerationService**: Generates ZK proofs using o1js circuits
- **ProofPublishingService**: Publishes proofs to Mina blockchain
- **JobQueueService**: pg-boss wrapper for async job processing

### Database
- **PostgresAdapter**: Instance-based Knex wrapper (NOT static methods)
- **AuthenticityRepository**: Repository pattern for data access
- **Migrations**: Two migrations - initial schema + job tracking fields
- **Status values**: `pending`, `processing`, `verified`, `failed`

### Worker
- **ProofGenerationWorker**: Processes jobs from pg-boss queue
- Updates status throughout lifecycle
- Handles retries (3 attempts with exponential backoff)
- Cleans up temporary files after processing

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

- `GET /health` - Health check
- `GET /api/version` - API version

### Admin Endpoints (dev mode or with ADMIN_API_KEY)
- `GET /api/admin/jobs/stats` - Queue statistics
- `GET /api/admin/jobs/failed?limit=10&offset=0` - Failed jobs
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
```

### Optional Variables
```bash
CIRCUIT_CACHE_PATH=./cache  # zkApp compilation cache
ADMIN_API_KEY=<api_key>     # Required for admin endpoints in production
```

## Implementation Details

### Job Queue (pg-boss)
- Queue name: `proof-generation`
- Singleton key prevents duplicate jobs for same hash
- Retry policy: 3 attempts with exponential backoff
- Job retention: 24 hours for auditing
- Worker concurrency: Configurable via pg-boss

### Database Schema
```sql
-- authenticity_records table
sha256_hash (PK)        -- Image hash
token_owner             -- Random address per image
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
```

### Security & Middleware
- **Helmet.js**: Security headers
- **CORS**: Configurable origins
- **Compression**: Response compression
- **File Upload**: Multer with size limits
- **Error Handling**: Consistent error responses
- **Request Logging**: Custom middleware

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

## Deployment

### Railway Configuration
- **API Service**: Lightweight (512MB RAM)
- **Worker Service**: Heavy (2GB RAM for proof generation)
- **Health Checks**: 180s timeout, 3 restart attempts
- **Auto-migrations**: Run at API startup
- **Circuit Compilation**: At worker startup

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
```

## Local Development Setup

1. **Start infrastructure**: `docker-compose up -d`
2. **Configure environment**: `cp .env.example .env`
3. **Run migrations**: `npm run db:migrate`
4. **Start services**:
   - Terminal 1: `npm run dev:api`
   - Terminal 2: `npm run dev:worker`
5. **Access tools**:
   - API: http://localhost:3000
   - pgweb: http://localhost:8081

## Testing Scripts

### Upload Testing
```bash
IMAGE_PATH=./image.png API_URL=http://localhost:3000 tsx test-upload.mts
```

### Admin API Testing
```bash
tsx test-admin.mts stats              # Queue statistics
tsx test-admin.mts failed             # List failed jobs
tsx test-admin.mts details <jobId>    # Job details
tsx test-admin.mts retry <jobId>      # Retry job

# Production with auth
ADMIN_API_KEY=key API_URL=https://api.example.com tsx test-admin.mts stats
```

## Common Issues & Solutions

1. **Database connection**: Ensure PostgreSQL is running via Docker
2. **Circuit compilation**: Allow 30-60 seconds for initial compilation
3. **Job failures**: Check worker logs and admin endpoints
4. **File cleanup**: Temporary files deleted after processing
5. **Memory issues**: Worker requires 2GB+ RAM for proof generation

## Important Notes

- **No SQLite support**: PostgreSQL-only (required for pg-boss)
- **No automated tests**: Use manual testing scripts
- **Instance-based adapters**: PostgresAdapter uses instance methods, not static
- **Cache directory**: Now in `.gitignore`, auto-created when needed
- **Service naming**: `ImageAuthenticityService` (was refactored from verification)
- **Database interface removed**: Direct PostgresAdapter usage (no DatabaseAdapter interface)