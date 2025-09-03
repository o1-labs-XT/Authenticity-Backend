/**
 * Database record for an authenticity proof
 */
export interface AuthenticityRecord {
  sha256_hash: string;
  token_owner_address: string;
  token_owner_private_key?: string | null;
  creator_public_key: string;
  signature: string;
  status: 'pending' | 'processing' | 'verified' | 'failed';
  created_at: string;
  verified_at?: string | null;
  transaction_id?: string | null;
  job_id?: string | null;
  processing_started_at?: string | null;
  failed_at?: string | null;
  failure_reason?: string | null;
  retry_count?: number;
}

/**
 * Input for creating a new authenticity record
 */
export interface CreateAuthenticityRecordInput {
  sha256Hash: string;
  tokenOwnerAddress: string;
  tokenOwnerPrivate: string;
  creatorPublicKey: string;
  signature: string;
}

/**
 * Result of checking for an existing image
 */
export interface ExistingImageResult {
  exists: boolean;
  tokenOwnerAddress?: string;
  status?: 'pending' | 'processing' | 'verified' | 'failed';
}

/**
 * Status update for an authenticity record
 */
export interface StatusUpdate {
  status?: 'pending' | 'processing' | 'verified' | 'failed';
  transactionId?: string;
}
