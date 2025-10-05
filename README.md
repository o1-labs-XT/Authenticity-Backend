# Provenance Backend

## Quick Start

```bash
# 1. Start PostgreSQL and MinIO
docker-compose up -d

# 2. Create MinIO bucket (first time only)
docker-compose exec minio mc mb /data/authenticity-local

# 3. Setup environment
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Run database migrations
npm run db:migrate

# 5. Start services (in separate terminals)
npm run dev:api      # API server on port 3000
npm run dev:worker   # Background worker for proof generation
```

## Admin Dashboard
```bash
cd admin-dashboard
cp .env.example .env.local
npm run dev
```

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