'use client';

import { useState, useEffect } from 'react';
import { challengeApi, userApi } from '@/lib/api';

export default function Dashboard() {
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newChallenge, setNewChallenge] = useState({
    title: '',
    description: '',
    startTime: '',
    endTime: ''
  });

  useEffect(() => {
    loadChallenges();
  }, []);

  const loadChallenges = async () => {
    try {
      const { data } = await challengeApi.list();
      setChallenges(data);
    } catch (error) {
      console.error('Failed to load challenges:', error);
    }
  };

  const createChallenge = async () => {
    setLoading(true);
    try {
      // Convert datetime-local to ISO string
      const challengeData = {
        ...newChallenge,
        startTime: new Date(newChallenge.startTime).toISOString(),
        endTime: new Date(newChallenge.endTime).toISOString()
      };
      await challengeApi.create(challengeData);
      setNewChallenge({ title: '', description: '', startTime: '', endTime: '' });
      await loadChallenges();
    } catch (error) {
      alert('Failed to create challenge');
    }
    setLoading(false);
  };

  const deleteChallenge = async (id: number) => {
    if (!confirm('Delete this challenge?')) return;
    try {
      await challengeApi.delete(id);
      await loadChallenges();
    } catch (error) {
      alert('Failed to delete challenge');
    }
  };

  const deleteUser = async () => {
    const wallet = prompt('Enter wallet address to delete:');
    if (!wallet) return;
    if (!confirm(`Delete user ${wallet}?`)) return;

    try {
      await userApi.delete(wallet);
      alert('User deleted successfully');
    } catch (error) {
      alert('Failed to delete user');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          TouchGrass Admin Dashboard
        </h1>

        {/* Create Challenge Card */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Create New Challenge</h2>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Title"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              value={newChallenge.title}
              onChange={(e) => setNewChallenge({...newChallenge, title: e.target.value})}
            />
            <textarea
              placeholder="Description"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              rows={3}
              value={newChallenge.description}
              onChange={(e) => setNewChallenge({...newChallenge, description: e.target.value})}
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <input
                  type="datetime-local"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={newChallenge.startTime}
                  onChange={(e) => setNewChallenge({...newChallenge, startTime: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                <input
                  type="datetime-local"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={newChallenge.endTime}
                  onChange={(e) => setNewChallenge({...newChallenge, endTime: e.target.value})}
                />
              </div>
            </div>
            <button
              onClick={createChallenge}
              disabled={loading || !newChallenge.title || !newChallenge.description || !newChallenge.startTime || !newChallenge.endTime}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create Challenge'}
            </button>
          </div>
        </div>

        {/* Challenges List */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">All Challenges</h2>
          <div className="space-y-4">
            {challenges.length === 0 ? (
              <p className="text-gray-500">No challenges yet</p>
            ) : (
              challenges.map((challenge: any) => (
                <div key={challenge.id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{challenge.title}</h3>
                      <p className="text-gray-600 mt-1">{challenge.description}</p>
                      <div className="text-sm text-gray-500 mt-2">
                        <p>Start: {new Date(challenge.startTime).toLocaleString()}</p>
                        <p>End: {new Date(challenge.endTime).toLocaleString()}</p>
                        <p className="mt-1">
                          Status: {challenge.active ?
                            <span className="text-green-600 font-medium">Active</span> :
                            <span className="text-gray-500">Inactive</span>
                          }
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteChallenge(challenge.id)}
                      className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 ml-4"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* User Management */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">User Management</h2>
          <button
            onClick={deleteUser}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
          >
            Delete User by Wallet
          </button>
        </div>
      </div>
    </div>
  );
}