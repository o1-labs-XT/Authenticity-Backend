/**
 * Database record for an authenticity proof
 */
export interface AuthenticityRecord {
  sha256_hash: string;
  token_owner_address: string;
  token_owner_private_key?: string | null;
  creator_public_key: string;
  signature: string;
  status: 'pending' | 'verified';
  created_at: string;
  verified_at?: string | null;
  transaction_id?: string | null;
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
  status?: 'pending' | 'verified';
}

/**
 * Status update for an authenticity record
 */
export interface StatusUpdate {
  status?: 'pending' | 'verified';
  transactionId?: string;
}