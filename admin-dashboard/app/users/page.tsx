'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import type { User } from '@/lib/types';
import Card from '@/components/Card';
import DataTable, { Column } from '@/components/DataTable';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [searchWallet, setSearchWallet] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWallet, setNewWallet] = useState('');

  const handleSearch = async () => {
    if (!searchWallet) {
      alert('Please enter a wallet address');
      return;
    }
    try {
      const data = await api.users.get(searchWallet);
      setUsers([data]);
    } catch (error) {
      alert('User not found');
      setUsers([]);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.users.create({ walletAddress: newWallet });
      alert('User created successfully');
      setNewWallet('');
      setShowCreateForm(false);
      setSearchWallet(newWallet);
      handleSearch();
    } catch (error) {
      alert('Failed to create user');
    }
  };

  const handleDelete = async (walletAddress: string) => {
    if (!confirm(`Delete user ${walletAddress}?`)) return;
    try {
      await api.users.delete(walletAddress);
      alert('User deleted successfully');
      setUsers(users.filter(u => u.walletAddress !== walletAddress));
    } catch (error) {
      alert('Failed to delete user');
    }
  };

  const columns: Column<User>[] = [
    {
      key: 'walletAddress' as keyof User,
      label: 'Wallet Address',
      render: (user: User) => (
        <span className="font-mono text-sm">{user.walletAddress}</span>
      )
    },
    {
      key: 'createdAt' as keyof User,
      label: 'Created At',
      render: (user: User) => user.createdAt.toLocaleString()
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (user: User) => (
        <button
          onClick={() => handleDelete(user.walletAddress)}
          className="text-red-600 hover:text-red-900"
        >
          Delete
        </button>
      )
    }
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Users</h1>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          {showCreateForm ? 'Cancel' : 'Create User'}
        </button>
      </div>

      {showCreateForm && (
        <Card title="Create New User" className="mb-8">
          <form onSubmit={handleCreate} className="space-y-4">
            <input
              type="text"
              required
              placeholder="B62q..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              value={newWallet}
              onChange={(e) => setNewWallet(e.target.value)}
            />
            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              >
                Create User
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Search User" className="mb-8">
        <div className="flex space-x-4">
          <input
            type="text"
            placeholder="Enter wallet address..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
            value={searchWallet}
            onChange={(e) => setSearchWallet(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            onClick={handleSearch}
            className="bg-gray-600 text-white px-6 py-2 rounded hover:bg-gray-700"
          >
            Search
          </button>
        </div>
      </Card>

      <Card title="Search Results">
        <DataTable
          data={users}
          columns={columns}
          emptyMessage="No users found. Search for a user by wallet address."
        />
      </Card>
    </div>
  );
}