-- Initial database setup for local development
-- This file is executed when the PostgreSQL container is first created

-- Enable uuid extension if needed (for gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto extension (sometimes needed for additional crypto functions)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create a separate schema for pg-boss if desired (optional)
-- pg-boss will create its own schema automatically if not specified