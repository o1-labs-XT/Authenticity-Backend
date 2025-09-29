'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { Challenge } from '@/lib/types';
import Card from '@/components/Card';
import DataTable, { Column } from '@/components/DataTable';

export default function ChallengesPage() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadChallenges();
  }, []);

  const loadChallenges = async () => {
    try {
      const data = await api.challenges.list();
      setChallenges(data);
    } catch (error) {
      console.error('Failed to load challenges:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this challenge?')) return;
    try {
      await api.challenges.delete(id);
      await loadChallenges();
    } catch (error) {
      alert('Failed to delete challenge');
    }
  };

  const columns: Column<Challenge>[] = [
    { key: 'title' as keyof Challenge, label: 'Title' },
    {
      key: 'description' as keyof Challenge,
      label: 'Description',
      render: (c: Challenge) => (
        <span className="text-gray-600 text-sm">{c.description}</span>
      )
    },
    {
      key: 'startTime' as keyof Challenge,
      label: 'Start Time',
      render: (c: Challenge) => new Date(c.startTime).toLocaleDateString()
    },
    {
      key: 'endTime' as keyof Challenge,
      label: 'End Time',
      render: (c: Challenge) => new Date(c.endTime).toLocaleDateString()
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (c: Challenge) => (
        <button
          onClick={() => handleDelete(c.id)}
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
        <h1 className="text-3xl font-bold text-gray-900">Challenges</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : 'Create Challenge'}
        </button>
      </div>

      {showForm && (
        <Card title="Create New Challenge" className="mb-8">
          <ChallengeForm
            onSubmit={async (data) => {
              setLoading(true);
              try {
                await api.challenges.create(data);
                setShowForm(false);
                await loadChallenges();
              } catch (error) {
                alert('Failed to create challenge');
              }
              setLoading(false);
            }}
            loading={loading}
            onCancel={() => setShowForm(false)}
          />
        </Card>
      )}

      <Card title="All Challenges">
        <DataTable data={challenges} columns={columns} />
      </Card>
    </div>
  );
}

// Simple form component
function ChallengeForm({
  onSubmit,
  loading,
  onCancel
}: {
  onSubmit: (data: any) => void;
  loading: boolean;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startTime: '',
    endTime: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      startTime: new Date(formData.startTime).toISOString(),
      endTime: new Date(formData.endTime).toISOString(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="text"
        placeholder="Title"
        required
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
        value={formData.title}
        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
      />
      <textarea
        placeholder="Description"
        required
        rows={3}
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
        value={formData.description}
        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-4">
        <input
          type="datetime-local"
          required
          className="px-3 py-2 border border-gray-300 rounded-md"
          value={formData.startTime}
          onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
        />
        <input
          type="datetime-local"
          required
          className="px-3 py-2 border border-gray-300 rounded-md"
          value={formData.endTime}
          onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
        />
      </div>
      <div className="flex justify-end space-x-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
  );
}