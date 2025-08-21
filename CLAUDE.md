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
  - SQLite database stores proof records indexed by SHA256 hash
  - `authenticity.repository.ts`: Data access layer for proof records

### Environment Configuration

Key environment variables:
- `MINA_NETWORK`: Network to use (local/testnet/mainnet)
- `ZKAPP_ADDRESS`: Deployed zkApp contract address
- `FEE_PAYER_PRIVATE_KEY`: Private key for transaction fees
- `DATABASE_PATH`: Path to SQLite database (default: ./data/provenance.db)
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production/test)
- `UPLOAD_MAX_SIZE`: Maximum upload size in bytes (default: 10MB)
- `CORS_ORIGIN`: CORS allowed origins

### API Endpoints

- `POST /api/upload` - Upload image with signature for proof generation
  - Expects multipart form data with `image` file and `signature` field
  - Returns: `{ sha256Hash, transactionId }` immediately, proof generation happens async
- `GET /api/status/:sha256Hash` - Check proof generation/publishing status
  - Returns: `{ status: "pending" | "verified", transactionId?, tokenOwner? }`
- `GET /api/token-owner/:sha256Hash` - Get token owner address for verification
  - Returns: `{ tokenOwner }` if verified
- `GET /health` - Health check endpoint for deployment monitoring
- `GET /api/version` - API version information

### Testing Strategy

- Unit tests mock external dependencies (database, blockchain)
- Integration tests use actual SQLite in-memory database
- Tests run sequentially (`maxWorkers: 1`) to avoid database conflicts
- Test setup in `tests/setup.ts` initializes test environment

### Important Implementation Details

- **Async Proof Generation**: Proofs are generated asynchronously after upload response
- **Token Owner Address**: Randomly generated for each unique image hash
- **Database States**: Records have "pending" or "verified" status
- **Error Handling**: Failed verifications result in deleted database records
- **SHA256 Verification**: Uses penultimate round state for efficient ZK verification
- **Security Middleware**: Uses Helmet.js for security headers, compression for responses
- **File Handling**: Temporary uploaded files are cleaned up after proof generation

### TypeScript Configuration

- Target: ES2022 with NodeNext modules
- Strict mode enabled
- Source maps and declarations generated
- Module imports must use `.js` extensions (even for `.ts` files)

### Deployment Notes

- Configured for Railway deployment (see `railway.json`)
- Health checks configured with 3 restart attempts on failure
- Migrations run automatically at startup (before server starts)
- Production uses PostgreSQL (DATABASE_URL auto-injected by Railway at runtime)
- Requires Node.js >= 20.0.0 and npm >= 10.0.0

### zkApp Circuit Compilation

The `scripts/compile-zkapp.ts` script pre-compiles the AuthenticityProgram and AuthenticityZkApp circuits:
- Clears existing cache (preserving .gitkeep)
- Compiles both circuits with caching enabled
- Runs automatically before production server starts
- Cache directory configured via CIRCUIT_CACHE_PATH
