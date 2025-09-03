# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Development
```bash
# Prerequisites: Start PostgreSQL first
docker-compose up -d  # Start PostgreSQL in Docker container

# Run both services (in separate terminals):
npm run dev           # Start API server with hot reload (or npm run dev:api)
npm run dev:worker    # Start worker with hot reload

# Alternative: run only one service
npm run dev:api       # API server only
npm run dev:worker    # Worker only

# Production commands:
npm run build         # Build TypeScript to dist/
npm run start:api     # Start API server only
npm run start:worker  # Start worker only
```

### Testing
```bash
npm test              # Run all tests with open handles detection  
npm run test:unit     # Run unit tests only
npm run test:integration  # Run integration tests only
npm run test:coverage # Run tests with coverage report
npm run test:watch    # Run tests in watch mode
```

**Note**: Test configuration uses Jest defaults. No Jest config file is present in the project.

### Database Management
```bash
npm run db:migrate    # Run database migrations using Knex
npm run db:migrate:dev # Run migrations for development environment
npm run db:migrate:prod # Run migrations for production environment
npm run db:rollback   # Rollback last migration
npm run db:migrate:make # Create new migration file
npm run db:seed       # Run database seeds
```

### Code Quality
```bash
npm run lint          # Run ESLint on src/**/*.ts
npm run format        # Format code with Prettier
```

## High-Level Architecture

This is a zero-knowledge proof backend for image authenticity verification built on the Mina Protocol. The system enables users to prove image authenticity without revealing sensitive information.

### Core Flow
1. **Upload Phase**: Users upload images with cryptographic signatures
2. **Job Queue**: Upload handler enqueues proof generation job in pg-boss
3. **Worker Processing**: Separate worker service processes jobs asynchronously
4. **Proof Generation**: Worker generates zero-knowledge proofs
5. **On-chain Publishing**: Worker publishes proofs to Mina blockchain
6. **Verification**: Anyone can verify image authenticity via token owner address

### Service Architecture

The codebase follows a layered architecture:
```
REST API → Handlers → Services → Database
```

#### Key Components

- **Handlers** (`src/handlers/`): Process HTTP requests and orchestrate services
  - `upload.handler.ts`: Manages image uploads, triggers proof generation
  - `status.handler.ts`: Returns proof generation status
  - `tokenOwner.handler.ts`: Returns token owner addresses for verification
  - `admin.handler.ts`: Admin endpoints for job management and monitoring

- **Services** (`src/services/`):
  - `image/verification.service.ts`: Computes SHA256 hashes and verifies signatures
  - `zk/proofGeneration.service.ts`: Generates zero-knowledge proofs using o1js
  - `zk/proofPublishing.service.ts`: Publishes proofs to Mina blockchain

- **Database** (`src/db/`):
  - PostgreSQL-only implementation (required for pg-boss job queue)
  - `adapters/DatabaseAdapter.ts`: Common interface for database operations
  - `adapters/PostgresAdapter.ts`: PostgreSQL implementation using Knex
  - `authenticity.repository.ts`: Repository pattern for data access
  - Migrations managed through Knex

- **Job Queue** (`src/services/queue/`):
  - `jobQueue.service.ts`: pg-boss integration for reliable async processing
  - Creates 'proof-generation' queue on startup (required for pg-boss v10)
  - Handles proof generation jobs with automatic retries
  - Uses singletonKey to prevent duplicate jobs for same image
  - Maintains job history for auditing

- **Workers** (`src/workers/`):
  - `proofGenerationWorker.ts`: Processes proof generation jobs from queue
  - Updates database status throughout job lifecycle
  - Handles retries and failure scenarios

- **Entry Points**:
  - `src/index.ts`: API server entry point
  - `src/worker.ts`: Worker service entry point

### Environment Configuration

Required environment variables:
- `DATABASE_URL`: PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/db`)
- `MINA_NETWORK`: Network to use (testnet/mainnet)
- `ZKAPP_ADDRESS`: Deployed zkApp contract address
- `FEE_PAYER_PRIVATE_KEY`: Private key for transaction fees
- `PORT`: Server port
- `NODE_ENV`: Environment (development/production/test)
- `CORS_ORIGIN`: CORS allowed origins
- `UPLOAD_MAX_SIZE`: Maximum upload size in bytes

Optional environment variables:
- `CIRCUIT_CACHE_PATH`: Directory for circuit compilation cache (default: ./cache)
- `ADMIN_API_KEY`: API key for admin endpoints in production (development mode doesn't require it)

For local development, use the provided docker-compose.yml:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/authenticity_dev
```

### API Endpoints

#### Public Endpoints
- `POST /api/upload` - Upload image with signature for proof generation
  - Expects multipart form data with `image` file, `signature`, and `publicKey` fields
  - Returns: `{ sha256Hash, tokenOwnerAddress, status }` immediately
  - Proof generation happens asynchronously in background via pg-boss job queue
- `GET /api/status/:sha256Hash` - Check proof generation/publishing status
  - Returns: `{ status: "pending" | "processing" | "verified" | "failed", transactionId?, tokenOwner? }`
- `GET /api/token-owner/:sha256Hash` - Get token owner address for verification
  - Returns: `{ tokenOwner }` if verified
- `GET /health` - Health check endpoint for deployment monitoring
- `GET /api/version` - API version information

#### Admin Endpoints (Development mode or with ADMIN_API_KEY)
- `GET /api/admin/jobs/stats` - Get job queue statistics
  - Returns queue counts (pending, active, completed, failed) and database status counts
- `GET /api/admin/jobs/failed?limit=10&offset=0` - List failed jobs with pagination
  - Returns failed job records with failure reasons and retry counts
- `GET /api/admin/jobs/:jobId` - Get detailed information about a specific job
  - Returns complete job data from pg-boss
- `POST /api/admin/jobs/:jobId/retry` - Retry a failed job
  - Requeues the job and resets status to pending

### Important Implementation Details

- **Job Queue Processing**: pg-boss handles async proof generation with retries
- **Token Owner Address**: Randomly generated for each unique image hash
- **Database States**: Records have "pending", "processing", "verified", or "failed" status
- **Error Handling**: Failed jobs are retried 3 times with exponential backoff
- **Job Deduplication**: Same image hash won't create duplicate jobs within 24 hours
- **SHA256 Verification**: Uses penultimate round state for efficient ZK verification
- **Security Middleware**: Uses Helmet.js for security headers, compression for responses
- **File Handling**: Temporary uploaded files are cleaned up after proof generation
- **Circuit Compilation**: zkApp circuits are pre-compiled on startup for better performance
- **Database Migrations**: Schema managed through Knex migrations

### TypeScript Configuration

- Target: ES2022 with NodeNext modules
- Strict mode enabled
- Source maps and declarations generated
- Module imports must use `.js` extensions (even for `.ts` files)

### Deployment Notes

- Configured for Railway deployment with separate services:
  - **API Service**: Handles HTTP requests, lightweight (512MB RAM)
  - **Worker Service**: Processes proof generation, heavy (2GB RAM)
- Health checks configured with 3 restart attempts on failure (180s timeout)
- Migrations run automatically at API startup
- Circuit compilation happens at worker startup (30-60 seconds)
- pg-boss handles job distribution across multiple workers
- Requires Node.js >= 20.0.0 and npm >= 10.0.0

### zkApp Circuit Compilation

The `scripts/compile-zkapp.ts` script pre-compiles the AuthenticityProgram and AuthenticityZkApp circuits:
- Clears existing cache (preserving .gitkeep)
- Compiles both circuits with caching enabled
- Runs automatically before production server starts
- Cache directory configured via CIRCUIT_CACHE_PATH
- Compilation typically takes 30-60 seconds

### Testing Scripts

#### Upload Testing
Use `test-upload.mts` to test the upload endpoint:
```bash
IMAGE_PATH=./image.png API_URL=http://localhost:3000 tsx test-upload.mts
```
The script generates a random keypair, signs the image, and uploads it to the specified endpoint.

#### Admin API Testing
Use `test-admin.mts` to test admin endpoints:
```bash
# Get job queue statistics
tsx test-admin.mts stats

# List failed jobs
tsx test-admin.mts failed

# Get job details
tsx test-admin.mts details <jobId>

# Retry a failed job
tsx test-admin.mts retry <jobId>

# For production with auth
ADMIN_API_KEY=your-key API_URL=https://api.example.com tsx test-admin.mts stats
```

### Local Development Setup

1. **Start PostgreSQL**: `docker-compose up -d`
2. **Copy environment**: `cp .env.example .env` and configure
3. **Run migrations**: `npm run db:migrate:dev`
4. **Start services** (in separate terminals):
   - API: `npm run dev` (or `npm run dev:api`)
   - Worker: `npm run dev:worker`

See `LOCAL_SETUP.md` for detailed instructions and troubleshooting.
