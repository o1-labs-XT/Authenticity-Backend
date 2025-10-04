// API Response Types - these need to be kept in sync with the
// types defined in the handlers in the backend api
export interface Challenge {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  participantCount: number;
  chainCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  walletAddress: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chain {
  id: string;
  name: string;
  challengeId: string;
  length: number;
  createdAt: Date;
  lastActivityAt: Date;
  updatedAt: Date;
}

export interface Submission {
  id: string;
  sha256Hash: string;
  walletAddress: string;
  signature: string;
  challengeId: string;
  chainId: string;
  storageKey: string;
  tagline?: string;
  chainPosition: number;
  status: string;
  transactionId?: string;
  failureReason?: string;
  retryCount: number;
  challengeVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticityRecord {
  sha256Hash: string;
  status: 'pending' | 'processing' | 'verified' | 'failed';
  tokenOwner?: string;
  transactionId?: string;
  error?: string;
  createdAt?: string;
  verifiedAt?: string;
}

export interface Job {
  id: string;
  state: string;
  data: any;
  output?: any;
  retrycount: number;
  createdon: string;
  completedon?: string;
}

export interface JobStats {
  queue: {
    created: number;
    active: number;
    completed: number;
    failed: number;
  };
  database: {
    pending: number;
    processing: number;
    verified: number;
    failed: number;
  };
  timestamp: string;
}

export interface ApiError {
  message: string;
  error?: string;
  statusCode?: number;
}
