# Provenance Backend

## Quick Start

```bash
# 1. Start PostgreSQL and MinIO
docker-compose up -d

# 2. Create MinIO bucket (first time only)
docker-compose exec minio mc mb /data/authenticity-local

# 3. Setup environment
cp .env.example .env
# Configure required variables:
# - ZKAPP_ADDRESS: Your deployed zkApp contract address
# - FEE_PAYER_PRIVATE_KEY: Private key for Mina transaction fees

# 3. Install dependencies
npm install

# 4. Run database migrations
npm run db:migrate

# 5. Start services (in separate terminals)
npm run dev:api      # API server on port 3000
npm run dev:worker   # Background worker for proof generation
```

## Architecture

The system uses a job queue architecture with two separate services:

- **API Server**: Handles HTTP requests, image uploads, and status queries
- **Worker Service**: Processes proof generation jobs asynchronously via pg-boss queue

### Flow

1. Client uploads image with cryptographic signature
2. API validates and enqueues proof generation job
3. Worker generates zero-knowledge proof
4. Worker publishes proof to Mina blockchain
5. Client can verify authenticity via token owner address

## Observability

Grafana dashboards are set up in docker-compose and configured to show logs collected with promtail and stored in Loki.
Access Grafana dashboards at http://localhost:3001 

## Database Management

### pgweb UI

Access the database through pgweb interface at http://localhost:8081

- Automatically connects to the development database
- No additional configuration needed
- Started automatically with `docker-compose up -d`

### PostgreSQL CLI

```shell
# Connect to PostgreSQL CLI
docker-compose exec postgres psql -U postgres authenticity_dev

# Delete and recreate the db
npm run db:reset
```

### pg-boss Admin

pg-boss creates its own schema (`pgboss`) with tables for job management:

```sql
-- Connect to database
docker-compose exec postgres psql -U postgres authenticity_dev

-- View job queue tables
\dt pgboss.*

-- Check pending jobs
SELECT id, name, state, created_on, retry_count
FROM pgboss.job
WHERE state IN ('created', 'retry')
ORDER BY created_on DESC;

-- View failed jobs
SELECT id, name, state, completed_on, output
FROM pgboss.job
WHERE state = 'failed'
ORDER BY completed_on DESC
LIMIT 10;
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

## API Endpoints

### Public

- `POST /api/upload` - Upload image for proof generation (multipart form: image, signature, publicKey)
- `GET /api/status/:sha256Hash` - Check proof status
- `GET /api/token-owner/:sha256Hash` - Get token owner for verification
- `GET /health` - Health check

### Admin (requires ADMIN_API_KEY in production)

- `GET /api/admin/jobs/stats` - Job queue statistics
- `GET /api/admin/jobs/failed` - List failed jobs
- `POST /api/admin/jobs/:jobId/retry` - Retry failed job
