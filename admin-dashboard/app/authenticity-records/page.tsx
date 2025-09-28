'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import type { AuthenticityRecord } from '@/lib/types';
import Card from '@/components/Card';

export default function AuthenticityRecordsPage() {
  const [searchHash, setSearchHash] = useState('');
  const [record, setRecord] = useState<AuthenticityRecord | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!searchHash) {
      alert('Please enter a SHA256 hash');
      return;
    }

    setLoading(true);
    try {
      const statusData = await api.authenticity.getStatus(searchHash);

      let tokenOwner = null;
      if (statusData.status === 'verified') {
        try {
          const ownerData = await api.authenticity.getTokenOwner(searchHash);
          tokenOwner = ownerData.tokenOwner;
        } catch (error) {
          console.error('Failed to get token owner:', error);
        }
      }

      setRecord({
        ...statusData,
        sha256Hash: searchHash,
        tokenOwner: tokenOwner || statusData.tokenOwner,
      });
    } catch (error) {
      alert('Record not found');
      setRecord(null);
    }
    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    const badges: { [key: string]: string } = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      verified: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };
    return badges[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Authenticity Records</h1>

      <Card title="Search by SHA256 Hash" className="mb-8">
        <div className="flex space-x-4">
          <input
            type="text"
            placeholder="Enter SHA256 hash..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
            value={searchHash}
            onChange={(e) => setSearchHash(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="bg-gray-600 text-white px-6 py-2 rounded hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-2">
          Enter the SHA256 hash of an uploaded image to check its verification status.
        </p>
      </Card>

      {record && (
        <Card title="Record Details">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  SHA256 Hash
                </label>
                <p className="font-mono text-sm break-all">{record.sha256Hash}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  Status
                </label>
                <span
                  className={`inline-block px-3 py-1 text-sm font-medium rounded ${getStatusBadge(
                    record.status
                  )}`}
                >
                  {record.status.toUpperCase()}
                </span>
              </div>
            </div>

            {record.status === 'verified' && record.tokenOwner && (
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  Token Owner Address
                </label>
                <p className="font-mono text-sm">{record.tokenOwner}</p>
              </div>
            )}

            {record.transactionId && (
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  Transaction ID
                </label>
                <p className="font-mono text-sm">{record.transactionId}</p>
                <a
                  href={`https://minascan.io/testnet/tx/${record.transactionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 text-sm mt-1 inline-block"
                >
                  View on Minascan →
                </a>
              </div>
            )}

            {record.status === 'failed' && record.error && (
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  Error Message
                </label>
                <p className="text-sm text-red-600">{record.error}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="mt-8 p-4 bg-blue-50 rounded-lg">
        <h3 className="font-semibold text-blue-900 mb-2">About Authenticity Records</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Records track the proof generation status for uploaded images</li>
          <li>• Each image gets a unique SHA256 hash identifier</li>
          <li>• Verified images have their proofs published to the Mina blockchain</li>
          <li>• Token owner addresses are randomly generated for each image</li>
          <li>• Status progression: pending → processing → verified (or failed)</li>
        </ul>
      </div>
    </div>
  );
}