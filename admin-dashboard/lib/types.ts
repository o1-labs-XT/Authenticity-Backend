// API Response Types
export interface Challenge {
  id: number;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  walletAddress: string;
  createdAt: string;
  updatedAt: string;
}

export interface Chain {
  id: number;
  name: string;
  challengeId: number;
  createdAt: string;
  submissions?: Submission[];
}

export interface Submission {
  id: number;
  userWalletAddress: string;
  chainPosition: number;
  tagline: string;
  sha256Hash: string;
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
  queues: {
    'proof-generation': {
      created: number;
      active: number;
      completed: number;
      failed: number;
    };
  };
}

export interface ApiError {
  message: string;
  error?: string;
  statusCode?: number;
}
