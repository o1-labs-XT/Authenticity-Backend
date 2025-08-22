# Local Development Setup

## Prerequisites

- Node.js >= 20.0.0
- Docker and Docker Compose
- npm >= 10.0.0

## Quick Start

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd authenticity-backend
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start PostgreSQL with Docker Compose**
   ```bash
   docker-compose up -d
   ```

   This will start PostgreSQL on port 5432 with:
   - Database: `authenticity_dev`
   - Username: `postgres`
   - Password: `postgres`

4. **Run database migrations**
   ```bash
   npm run db:migrate:dev
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

## Database Management

### View PostgreSQL logs
```bash
docker-compose logs -f postgres
```

### Connect to PostgreSQL CLI
```bash
docker-compose exec postgres psql -U postgres authenticity_dev
```

### Stop PostgreSQL
```bash
docker-compose down
```

### Reset database (warning: deletes all data)
```bash
docker-compose down -v
docker-compose up -d
npm run db:migrate:dev
```

## pg-boss Admin

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

## Troubleshooting

### Port 5432 already in use
If you have another PostgreSQL instance running:
```bash
# Option 1: Stop the other instance
sudo systemctl stop postgresql

# Option 2: Use a different port
# Edit docker-compose.yml to use port 5433:5432
# Update .env DATABASE_URL to use port 5433
```

### Connection refused
Make sure Docker is running and the PostgreSQL container is up:
```bash
docker-compose ps
# Should show postgres container as "Up"
```

### Database does not exist
The database is created automatically when the container starts. If it's missing:
```bash
docker-compose down
docker-compose up -d
# Wait a few seconds for initialization
```