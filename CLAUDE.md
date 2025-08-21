# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Development
```bash
npm run dev           # Start dev server with hot reload (uses tsx + nodemon)
npm run build         # Build TypeScript to dist/
npm start             # Run migrations, compile zkApp circuits, then start production server
```

### Testing
```bash
npm test              # Run all tests with open handles detection
npm run test:unit     # Run unit tests only
npm run test:integration  # Run integration tests only
npm run test:coverage # Run tests with coverage report
npm run test:watch    # Run tests in watch mode
```

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
2. **Proof Generation**: Backend generates zero-knowledge proofs asynchronously
3. **On-chain Publishing**: Proofs are published to Mina blockchain
4. **Verification**: Anyone can verify image authenticity via token owner address

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

- **Services** (`src/services/`):
  - `image/verification.service.ts`: Computes SHA256 hashes and verifies signatures
  - `zk/proofGeneration.service.ts`: Generates zero-knowledge proofs using o1js
  - `zk/proofPublishing.service.ts`: Publishes proofs to Mina blockchain

- **Database** (`src/db/`):
  - Dual database support via adapter pattern
  - `adapters/DatabaseAdapter.ts`: Common interface for database operations
  - `adapters/PostgresAdapter.ts`: PostgreSQL implementation using Knex
  - `adapters/SqliteAdapter.ts`: SQLite implementation using Knex
  - `authenticity.repository.ts`: Repository pattern for data access
  - Database selection: Uses PostgreSQL if DATABASE_URL is set, otherwise SQLite

### Environment Configuration

Required environment variables:
- `MINA_NETWORK`: Network to use (testnet/mainnet)
- `ZKAPP_ADDRESS`: Deployed zkApp contract address
- `FEE_PAYER_PRIVATE_KEY`: Private key for transaction fees
- `PORT`: Server port
- `NODE_ENV`: Environment (development/production/test)
- `CORS_ORIGIN`: CORS allowed origins
- `UPLOAD_MAX_SIZE`: Maximum upload size in bytes

Optional environment variables:
- `DATABASE_URL`: PostgreSQL connection string (when set, uses PostgreSQL)
- `DATABASE_PATH`: Path to SQLite database (default: ./data/provenance.db)
- `CIRCUIT_CACHE_PATH`: Directory for circuit compilation cache (default: ./cache)

### API Endpoints

- `POST /api/upload` - Upload image with signature for proof generation
  - Expects multipart form data with `image` file, `signature`, and `publicKey` fields
  - Returns: `{ sha256Hash, tokenOwnerAddress, status }` immediately
  - Proof generation happens asynchronously in background
- `GET /api/status/:sha256Hash` - Check proof generation/publishing status
  - Returns: `{ status: "pending" | "verified", transactionId?, tokenOwner? }`
- `GET /api/token-owner/:sha256Hash` - Get token owner address for verification
  - Returns: `{ tokenOwner }` if verified
- `GET /health` - Health check endpoint for deployment monitoring
- `GET /api/version` - API version information

### Important Implementation Details

- **Async Proof Generation**: Proofs are generated asynchronously after upload response
- **Token Owner Address**: Randomly generated for each unique image hash
- **Database States**: Records have "pending" or "verified" status
- **Error Handling**: Failed verifications result in deleted database records
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

- Configured for Railway deployment (see `railway.json`)
- Health checks configured with 3 restart attempts on failure (180s timeout)
- Migrations run automatically at startup before server starts
- Circuit compilation happens at startup (can take 30-60 seconds)
- Requires Node.js >= 20.0.0 and npm >= 10.0.0

### zkApp Circuit Compilation

The `scripts/compile-zkapp.ts` script pre-compiles the AuthenticityProgram and AuthenticityZkApp circuits:
- Clears existing cache (preserving .gitkeep)
- Compiles both circuits with caching enabled
- Runs automatically before production server starts
- Cache directory configured via CIRCUIT_CACHE_PATH
- Compilation typically takes 30-60 seconds

### Testing Upload Script

Use `test-upload.mts` to test the upload endpoint:
```bash
IMAGE_PATH=./image.png API_URL=http://localhost:3000 tsx test-upload.mts
```
The script generates a random keypair, signs the image, and uploads it to the specified endpoint.