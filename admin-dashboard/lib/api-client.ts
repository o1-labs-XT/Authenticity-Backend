import type { Challenge, User, Chain, AuthenticityRecord, Job, JobStats } from './types';

/**
 * API client wraps backend API calls with proxy routing.
 *
 * Uses Next.js API routes as a proxy layer between the frontend and backend API
 * Frontend calls next server /api/proxy/challenges, next server calls back end /api/challenges
 * - Avoids CORS issues, next server is same origin as client
 * - Keeps API keys (ADMIN_API_KEY) server side
 */
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

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  // Challenges
  challenges = {
    list: () => this.request<Challenge[]>('challenges'),
    get: (id: string) => this.request<Challenge>(`challenges/${id}`),
    getActive: () => this.request<Challenge[]>('challenges/active'),
    create: (data: Partial<Challenge>) =>
      this.request<Challenge>('challenges', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) => this.request<void>(`challenges/${id}`, { method: 'DELETE' }),
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
    get: (id: string) => this.request<Chain>(`chains/${id}`),
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
