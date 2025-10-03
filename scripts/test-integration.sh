#!/bin/bash
set -e

# Use test database
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/authenticity_test"

# Set test environment variables for integration tests
export TEST_API_URL="http://localhost:3000"
export TEST_ADMIN_USERNAME="admin"
export TEST_ADMIN_PASSWORD="serverpass"

# Cleanup function
cleanup() {
  echo "Cleaning up..."
  [ -n "$SERVER_PID" ] && kill $SERVER_PID 2>/dev/null
  # Drop test database
  docker-compose exec -T postgres psql -U postgres -c "DROP DATABASE IF EXISTS authenticity_test;" 2>/dev/null || true
}
trap cleanup EXIT

# Start PostgreSQL and MinIO
docker-compose up -d postgres minio

# Wait for PostgreSQL
until docker-compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done

# Kill any existing connections to test database
docker-compose exec -T postgres psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'authenticity_test' AND pid <> pg_backend_pid();" 2>/dev/null || true

# Create test database
docker-compose exec -T postgres psql -U postgres -c "DROP DATABASE IF EXISTS authenticity_test;"
docker-compose exec -T postgres psql -U postgres -c "CREATE DATABASE authenticity_test;"

# Setup database
npm run db:migrate
npm run build

# Start API server with test database
npm run dev:api > /tmp/test-server.log 2>&1 &
SERVER_PID=$!

# Wait for server
until curl -s http://localhost:3000/health >/dev/null 2>&1; do
  sleep 1
done

# Run tests
npx vitest run test/integration || {
  echo "Tests failed! Server logs:"
  tail -20 /tmp/test-server.log
  exit 1
}