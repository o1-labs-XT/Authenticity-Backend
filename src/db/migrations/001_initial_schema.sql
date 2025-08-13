-- Initial schema for Provenance Backend
-- Creates tables for tracking image authenticity records

-- Main table for authenticity records
CREATE TABLE IF NOT EXISTS authenticity_records (
  sha256_hash TEXT PRIMARY KEY,
  token_owner_address TEXT NOT NULL,
  creator_public_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'verified', 'failed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMP,
  transaction_id TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  proof_data TEXT  -- JSON serialized proof data
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_status ON authenticity_records(status);
CREATE INDEX IF NOT EXISTS idx_token_owner ON authenticity_records(token_owner_address);
CREATE INDEX IF NOT EXISTS idx_created_at ON authenticity_records(created_at);

-- Supporting table for proof queue (for future queue implementation)
CREATE TABLE IF NOT EXISTS proof_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256_hash TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK(task_type IN ('generate', 'publish')),
  payload TEXT NOT NULL,  -- JSON serialized task data
  status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'completed', 'failed')),
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,
  error_message TEXT,
  FOREIGN KEY (sha256_hash) REFERENCES authenticity_records(sha256_hash)
);

-- Indexes for queue performance
CREATE INDEX IF NOT EXISTS idx_queue_status ON proof_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_created ON proof_queue(created_at);

-- Migration tracking table
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);