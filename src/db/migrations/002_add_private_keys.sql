-- Add private key columns for transaction signing
-- These are needed to sign blockchain transactions

-- Add token owner private key
ALTER TABLE authenticity_records
ADD COLUMN token_owner_private_key TEXT;

-- Add creator private key (for future use if needed)
ALTER TABLE authenticity_records
ADD COLUMN creator_private_key TEXT;

-- Update existing records to have NULL values (they won't be usable for signing)
-- New records will have proper private keys