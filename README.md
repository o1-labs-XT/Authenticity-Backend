# Provenance Backend

## Quick Start

```bash
# 1. Start PostgreSQL and MinIO
docker-compose up -d

# 2. Create MinIO bucket (first time only)
docker-compose exec minio mc mb /data/authenticity-local

# 3. Setup environment, ensure FEE_PAYER_PRIVATE_KEY is set to the key that deployed the zkapp
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Run database migrations
npm run db:migrate

# 5. Start services (in separate terminals)
npm run dev:api         # API server on port 3000
npm run dev:deployment  # Contract deployment worker (required for challenges)
npm run dev:worker      # Proof generation worker (processes approved submissions)
npm run dev:monitoring  # Blockchain monitoring worker (optional, tracks tx status)
```

## Admin Dashboard
```bash
cd admin-dashboard
cp .env.example .env.local
npm run dev
```

## Key Generation

Generate ECDSA keypair for image signature verification:

```bash
npx tsx scripts/generate-signer-keypair.mts
```

This generates keys for `SIGNER_PUBLIC_KEY` and `SIGNER_PRIVATE_KEY`. Add them to:

**Production/Development (must match):**
- **Backend `.env`** - Add `SIGNER_PUBLIC_KEY` (server verifies signatures)
- **Admin Dashboard `admin-dashboard/.env.local`** - Add `SIGNER_PRIVATE_KEY` (Secret, dashboard signs images)

**Testing (separate keypair):**
- **Backend `.env.test`** - Add both keys, integration tests can use their own test keypair


## API Endpoints

- See swagger docs at http://localhost:3000/api-docs

## Database Management

### pgweb UI

Access the database through pgweb interface at http://localhost:8081

### PostgreSQL CLI

```shell
# Connect to PostgreSQL CLI
docker-compose exec postgres psql -U postgres authenticity_dev

# Delete and recreate the db
npm run db:reset
```

## Railway Deployment

### Setup Railway CLI

```bash
# Install and login
npm install -g @railway/cli
railway login
railway link  # Select project/environment

# Switch environments
railway environment staging
railway environment production
```

### Connect to DB

```bash
railway connect postgres
```

### View Logs

```bash
railway logs --service api
railway logs --service worker
railway logs -f  # Tail logs
```