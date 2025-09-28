import type { Challenge, User, Chain, AuthenticityRecord, Job, JobStats } from './types';

// Simple API client that uses our proxy route
class ApiClient {
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`/api/proxy/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Request failed: ${response.status}`);
    }

    return response.json();
  }

  // Challenges
  challenges = {
    list: () => this.request<Challenge[]>('challenges'),
    get: (id: number) => this.request<Challenge>(`challenges/${id}`),
    getActive: () => this.request<Challenge[]>('challenges/active'),
    create: (data: Partial<Challenge>) =>
      this.request<Challenge>('challenges', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: number) => this.request<void>(`challenges/${id}`, { method: 'DELETE' }),
  };

  // Users
  users = {
    get: (walletAddress: string) => this.request<User>(`users/${walletAddress}`),
    create: (data: { walletAddress: string }) =>
      this.request<User>('users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (walletAddress: string) =>
      this.request<void>(`users/${walletAddress}`, { method: 'DELETE' }),
  };

  // Chains
  chains = {
    list: () => this.request<Chain[]>('chains'),
    get: (id: number) => this.request<Chain>(`chains/${id}`),
  };

  // Authenticity
  authenticity = {
    getStatus: (sha256Hash: string) => this.request<AuthenticityRecord>(`status/${sha256Hash}`),
    getTokenOwner: (sha256Hash: string) =>
      this.request<{ tokenOwner: string }>(`token-owner/${sha256Hash}`),
  };

  // Jobs
  jobs = {
    stats: () => this.request<JobStats>('admin/jobs/stats'),
    failed: (limit = 10, offset = 0) =>
      this.request<{ jobs: Job[] }>(`admin/jobs/failed?limit=${limit}&offset=${offset}`),
    details: (jobId: string) => this.request<Job>(`admin/jobs/${jobId}`),
    retry: (jobId: string) => this.request<void>(`admin/jobs/${jobId}/retry`, { method: 'POST' }),
  };
}

export const api = new ApiClient();
