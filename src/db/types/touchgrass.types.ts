// Database Models

export interface User {
  wallet_address: string;
  created_at: string;
  updated_at: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  participant_count: number;
  chain_count: number;
  created_at: string;
  updated_at: string;
}

export interface Chain {
  id: string;
  name: string;
  challenge_id: string;
  length: number;
  created_at: string;
  last_activity_at: string;
  updated_at: string;
}

export interface Submission {
  id: string;
  sha256_hash: string;
  wallet_address: string; // User's wallet address (public key)
  signature: string;
  challenge_id: string;
  chain_id: string;
  storage_key: string;
  tagline?: string | null;
  chain_position: number;
  status:
    | 'uploading'
    | 'verifying'
    | 'awaiting_review'
    | 'rejected'
    | 'publishing'
    | 'confirming'
    | 'verified'
    | 'pending_position'
    | 'complete'
    | 'failed';
  transaction_id?: string | null;
  failure_reason?: string | null;
  retry_count: number;
  challenge_verified: boolean;
  created_at: string;
  updated_at: string;
}
