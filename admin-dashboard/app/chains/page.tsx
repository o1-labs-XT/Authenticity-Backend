'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { Chain } from '@/lib/types';
import Card from '@/components/Card';
import DataTable, { Column } from '@/components/DataTable';

export default function ChainsPage() {
  const [chains, setChains] = useState<Chain[]>([]);
  const [selectedChain, setSelectedChain] = useState<Chain | null>(null);

  useEffect(() => {
    loadChains();
  }, []);

  const loadChains = async () => {
    try {
      const data = await api.chains.list();
      setChains(data);
    } catch (error) {
      console.error('Failed to load chains:', error);
    }
  };

  const viewChainDetails = async (id: string) => {
    try {
      const data = await api.chains.get(id);
      setSelectedChain(data);
    } catch (error) {
      alert('Failed to load chain details');
    }
  };

  const columns: Column<Chain>[] = [
    { key: 'id' as keyof Chain, label: 'ID' },
    { key: 'name' as keyof Chain, label: 'Name' },
    { key: 'challengeId' as keyof Chain, label: 'Challenge ID' },
    {
      key: 'createdAt' as keyof Chain,
      label: 'Created At',
      render: (chain: Chain) => new Date(chain.createdAt).toLocaleString()
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (chain: Chain) => (
        <button
          onClick={() => viewChainDetails(chain.id)}
          className="text-blue-600 hover:text-blue-900"
        >
          View Details
        </button>
      )
    }
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Chains</h1>

      {/* Chain Details Modal */}
      {selectedChain && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-semibold">{selectedChain.name}</h2>
                <button
                  onClick={() => setSelectedChain(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Chain ID</label>
                  <p className="text-lg">{selectedChain.id}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Challenge ID</label>
                  <p className="text-lg">{selectedChain.challengeId}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Length</label>
                  <p className="text-lg">{selectedChain.length}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Created At</label>
                  <p className="text-lg">
                    {new Date(selectedChain.createdAt).toLocaleString()}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Last Activity</label>
                  <p className="text-lg">
                    {new Date(selectedChain.lastActivityAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <Card title="All Chains">
        <DataTable data={chains} columns={columns} emptyMessage="No chains found" />
      </Card>

      <div className="mt-4 p-4 bg-blue-50 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> Chains are read-only. They represent groups of submissions
          for challenges and are created automatically when users participate.
        </p>
      </div>
    </div>
  );
}