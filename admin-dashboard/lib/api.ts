import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  auth: {
    username: 'admin',
    password: 'pass',
  },
});

export const challengeApi = {
  list: () => api.get('/api/challenges'),
  getActive: () => api.get('/api/challenges/active'),
  create: (data: any) => api.post('/api/challenges', data),
  update: (id: number, data: any) => api.put(`/api/challenges/${id}`, data),
  delete: (id: number) => api.delete(`/api/challenges/${id}`),
};

export const userApi = {
  delete: (walletAddress: string) => api.delete(`/api/users/${walletAddress}`),
};
