import { Field } from 'o1js';

/**
 * Database record for an authenticity proof
 */
export interface AuthenticityRecord {
  sha256_hash: string;
  token_owner_address: string;
  token_owner_private_key?: string | null;
  creator_public_key: string;
  creator_private_key?: string | null;
  signature: string;
  status: 'pending' | 'verified' | 'failed';
  created_at: string;
  verified_at?: string | null;
  transaction_id?: string | null;
  error_message?: string | null;
  proof_data?: string | null;
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
  status?: 'pending' | 'verified' | 'failed';
}

/**
 * Status update for an authenticity record
 */
export interface StatusUpdate {
  status: 'verified' | 'failed';
  transactionId?: string;
  errorMessage?: string;
  proofData?: any;
}

/**
 * Task for proof generation
 */
export interface ProofGenerationTask {
  sha256Hash: string;
  tokenOwnerAddress: string;
  tokenOwnerPrivateKey: string;
  publicKey: string;
  signature: string;
  verificationInputs: VerificationInputs;
  imagePath?: string;
}

/**
 * Task for proof publishing
 */
export interface ProofPublishingTask {
  sha256Hash: string;
  proof: any; // AuthenticityProof
  publicInputs: any; // AuthenticityInputs
  tokenOwnerAddress: string;
  tokenOwnerPrivateKey: string;
  creatorPublicKey: string;
}

/**
 * Verification inputs from prepareImageVerification
 */
export interface VerificationInputs {
  expectedHash: Field;
  penultimateState: any[]; // UInt32[] from authenticity-zkapp
  initialState: any[]; // UInt32[] from authenticity-zkapp
  messageWord: any; // UInt32 from authenticity-zkapp
  roundConstant: any; // UInt32 from authenticity-zkapp
}

/**
 * API response for upload endpoint
 */
export interface UploadResponse {
  tokenOwnerAddress: string;
  sha256Hash?: string;
  status: 'pending' | 'duplicate';
}

/**
 * API response for status endpoint
 */
export interface StatusResponse {
  status: 'pending' | 'verified' | 'failed';
  tokenOwnerAddress?: string;
  transactionId?: string;
  errorMessage?: string;
}

/**
 * API response for token owner endpoint
 */
export interface TokenOwnerResponse {
  tokenOwnerAddress?: string;
  status?: 'pending' | 'verified' | 'failed';
  found: boolean;
}

/**
 * API error response
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    field?: string;
  };
}
