#!/bin/bash
set -e

# Cleanup function
cleanup() {
  echo "Cleaning up..."
  [ -n "$SERVER_PID" ] && kill $SERVER_PID 2>/dev/null
}
trap cleanup EXIT

# Start services
docker-compose up -d postgres

# Wait for PostgreSQL
until docker-compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done

# Setup database
npm run db:migrate
npm run build

# Start API server
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