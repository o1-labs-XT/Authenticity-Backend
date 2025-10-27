'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { Submission, Chain, Like } from '@/lib/types';
import Card from '@/components/Card';
import DataTable, { Column } from '@/components/DataTable';

export default function SubmissionsPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reviewingSubmission, setReviewingSubmission] = useState<Submission | null>(null);
  const [viewingSubmission, setViewingSubmission] = useState<Submission | null>(null);

  const loadSubmissions = useCallback(async () => {
    try {
      setLoading(true);
      const filters = statusFilter ? { status: statusFilter } : undefined;
      const data = await api.submissions.list(filters);
      setSubmissions(data);
    } catch (error) {
      console.error('Failed to load submissions:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this submission?')) return;
    try {
      await api.submissions.delete(id);
      await loadSubmissions();
    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to delete submission';
      alert(errorMessage);
    }
  };

  const handleReview = (submission: Submission) => {
    setReviewingSubmission(submission);
  };

  const handleApprove = async () => {
    if (!reviewingSubmission) return;
    try {
      await api.submissions.review(reviewingSubmission.id, { challengeVerified: true });
      setReviewingSubmission(null);
      await loadSubmissions();
    } catch (error: any) {
      alert(error?.message || 'Failed to approve submission');
    }
  };

  const handleReject = async () => {
    if (!reviewingSubmission) return;
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;

    try {
      await api.submissions.review(reviewingSubmission.id, {
        challengeVerified: false,
        failureReason: reason,
      });
      setReviewingSubmission(null);
      await loadSubmissions();
    } catch (error: any) {
      alert(error?.message || 'Failed to reject submission');
    }
  };

  const getStatusBadgeColor = (status: string) => {
    const colors: Record<string, string> = {
      uploading: 'bg-blue-100 text-blue-800',
      verifying: 'bg-yellow-100 text-yellow-800',
      awaiting_review: 'bg-purple-100 text-purple-800',
      rejected: 'bg-red-100 text-red-800',
      processing: 'bg-indigo-100 text-indigo-800',
      publishing: 'bg-indigo-100 text-indigo-800',
      confirming: 'bg-orange-100 text-orange-800',
      verified: 'bg-green-100 text-green-800',
      pending_position: 'bg-gray-100 text-gray-800',
      complete: 'bg-emerald-100 text-emerald-800',
      failed: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const columns: Column<Submission>[] = [
    {
      key: 'walletAddress' as keyof Submission,
      label: 'Wallet',
      render: (s: Submission) => (
        <span className="font-mono text-xs">{s.walletAddress.slice(0, 8)}...</span>
      )
    },
    {
      key: 'tagline' as keyof Submission,
      label: 'Tagline',
      render: (s: Submission) => (
        <span className="text-gray-600">{s.tagline || '-'}</span>
      )
    },
    {
      key: 'status' as keyof Submission,
      label: 'Status',
      render: (s: Submission) => (
        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadgeColor(s.status)}`}>
          {s.status}
        </span>
      )
    },
    {
      key: 'chainPosition' as keyof Submission,
      label: 'Chain Position',
      render: (s: Submission) => <span>#{s.chainPosition}</span>
    },
    {
      key: 'challengeVerified' as keyof Submission,
      label: 'Verified',
      render: (s: Submission) => (
        <span className={s.challengeVerified ? 'text-green-600' : 'text-gray-400'}>
          {s.challengeVerified ? '✓' : '✗'}
        </span>
      )
    },
    {
      key: 'createdAt' as keyof Submission,
      label: 'Created',
      render: (s: Submission) => new Date(s.createdAt).toLocaleDateString()
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (s: Submission) => (
        <div className="flex gap-2">
          {s.status === 'awaiting_review' && (
            <button
              onClick={() => handleReview(s)}
              className="text-blue-600 hover:text-blue-900 font-medium"
            >
              Review
            </button>
          )}
          <button
            onClick={() => setViewingSubmission(s)}
            className="text-green-600 hover:text-green-900 font-medium"
          >
            View Details
          </button>
          <button
            onClick={() => handleDelete(s.id)}
            className="text-red-600 hover:text-red-900"
          >
            Delete
          </button>
        </div>
      )
    }
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Submissions</h1>
        <div className="flex gap-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md"
          >
            <option value="">All Statuses</option>
            <option value="uploading">Uploading</option>
            <option value="verifying">Verifying</option>
            <option value="awaiting_review">Awaiting Review</option>
            <option value="rejected">Rejected</option>
            <option value="processing">Processing</option>
            <option value="publishing">Publishing</option>
            <option value="confirming">Confirming</option>
            <option value="verified">Verified</option>
            <option value="pending_position">Pending Position</option>
            <option value="complete">Complete</option>
            <option value="failed">Failed</option>
          </select>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : 'Create Submission'}
          </button>
        </div>
      </div>

      {showForm && (
        <Card title="Create New Submission" className="mb-8">
          <SubmissionForm
            onSubmit={async (formData) => {
              setLoading(true);
              try {
                await api.submissions.create(formData);
                setShowForm(false);
                await loadSubmissions();
              } catch (error: any) {
                const errorMessage = error?.message || 'Failed to create submission';
                alert(errorMessage);
              }
              setLoading(false);
            }}
            loading={loading}
            onCancel={() => setShowForm(false)}
          />
        </Card>
      )}

      <Card title={`${loading ? 'Loading...' : `Submissions (${submissions.length})`}`}>
        <DataTable data={submissions} columns={columns} />
      </Card>

      {reviewingSubmission && (
        <ReviewModal
          submission={reviewingSubmission}
          onApprove={handleApprove}
          onReject={handleReject}
          onClose={() => setReviewingSubmission(null)}
        />
      )}

      {viewingSubmission && (
        <DetailsModal
          submission={viewingSubmission}
          onClose={() => setViewingSubmission(null)}
        />
      )}
    </div>
  );
}

// Details Modal Component - For viewing any submission and managing likes
function DetailsModal({
  submission,
  onClose,
}: {
  submission: Submission;
  onClose: () => void;
}) {
  const imageUrl = api.submissions.getImageUrl(submission.id);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-2xl font-bold text-gray-900">Submission Details</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Wallet:</span>{' '}
                  <span className="font-mono text-xs">{submission.walletAddress}</span>
                </div>
                <div>
                  <span className="font-semibold">Chain Position:</span> #{submission.chainPosition}
                </div>
                <div>
                  <span className="font-semibold">Status:</span>{' '}
                  <span className="font-mono text-xs">{submission.status}</span>
                </div>
                <div>
                  <span className="font-semibold">Verified:</span>{' '}
                  <span className={submission.challengeVerified ? 'text-green-600' : 'text-gray-400'}>
                    {submission.challengeVerified ? '✓ Approved' : '✗ Not verified'}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="font-semibold">Tagline:</span> {submission.tagline || '-'}
                </div>
                <div>
                  <span className="font-semibold">Created:</span>{' '}
                  {new Date(submission.createdAt).toLocaleString()}
                </div>
                <div>
                  <span className="font-semibold">Updated:</span>{' '}
                  {new Date(submission.updatedAt).toLocaleString()}
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Submitted Image:</h3>
              <img
                src={imageUrl}
                alt="Submission"
                className="w-full rounded border border-gray-300"
              />
            </div>

            <LikesTestingPanel submissionId={submission.id} />

            <div className="flex justify-end gap-4 pt-4 border-t">
              <button
                onClick={onClose}
                className="px-6 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Review Modal Component
function ReviewModal({
  submission,
  onApprove,
  onReject,
  onClose,
}: {
  submission: Submission;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const imageUrl = api.submissions.getImageUrl(submission.id);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-2xl font-bold text-gray-900">Review Submission</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Wallet:</span>{' '}
                  <span className="font-mono text-xs">{submission.walletAddress}</span>
                </div>
                <div>
                  <span className="font-semibold">Chain Position:</span> #{submission.chainPosition}
                </div>
                <div>
                  <span className="font-semibold">Tagline:</span> {submission.tagline || '-'}
                </div>
                <div>
                  <span className="font-semibold">Created:</span>{' '}
                  {new Date(submission.createdAt).toLocaleString()}
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Submitted Image:</h3>
              <img
                src={imageUrl}
                alt="Submission"
                className="w-full rounded border border-gray-300"
              />
            </div>

            <div className="flex justify-end gap-4 pt-4 border-t">
              <button
                onClick={onClose}
                className="px-6 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={onReject}
                className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Reject
              </button>
              <button
                onClick={onApprove}
                className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Likes Testing Panel Component
function LikesTestingPanel({ submissionId }: { submissionId: string }) {
  const [likes, setLikes] = useState<Like[]>([]);
  const [eligibleLikers, setEligibleLikers] = useState<string[]>([]);
  const [selectedLiker, setSelectedLiker] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const loadLikes = useCallback(async () => {
    try {
      const data = await api.likes.list(submissionId);
      setLikes(data);
    } catch (error) {
      console.error('Failed to load likes:', error);
    }
  }, [submissionId]);

  const loadEligibleLikers = useCallback(async () => {
    try {
      // Get all approved submissions and extract unique wallet addresses
      const approvedSubmissions = await api.submissions.list();
      const uniqueWallets = new Set(
        approvedSubmissions
          .filter(s => s.challengeVerified)
          .map(s => s.walletAddress)
      );
      const likers = Array.from(uniqueWallets);
      setEligibleLikers(likers);
    } catch (error) {
      console.error('Failed to load eligible likers:', error);
    }
  }, []);

  useEffect(() => {
    loadLikes();
    loadEligibleLikers();
  }, [loadLikes, loadEligibleLikers]);

  const handleAddLike = async () => {
    if (!selectedLiker) {
      alert('Please select a user');
      return;
    }

    setLoading(true);
    try {
      await api.likes.create(submissionId, selectedLiker);
      setSelectedLiker('');
      await loadLikes();
    } catch (error: any) {
      alert(error?.message || 'Failed to add like');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveLike = async (walletAddress: string) => {
    setLoading(true);
    try {
      await api.likes.delete(submissionId, walletAddress);
      await loadLikes();
    } catch (error: any) {
      alert(error?.message || 'Failed to remove like');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t pt-4">
      <h3 className="font-semibold mb-3">Likes Testing ({likes.length})</h3>

      {likes.length > 0 && (
        <div className="mb-4 space-y-2">
          {likes.map((like) => (
            <div key={like.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
              <span className="font-mono text-xs">{like.walletAddress.slice(0, 12)}...{like.walletAddress.slice(-8)}</span>
              <button
                onClick={() => handleRemoveLike(like.walletAddress)}
                disabled={loading}
                className="text-red-600 hover:text-red-800 text-sm disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <select
          value={selectedLiker}
          onChange={(e) => setSelectedLiker(e.target.value)}
          disabled={loading}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50"
        >
          <option value="">Select user with approved submission...</option>
          {eligibleLikers.map((wallet) => (
            <option key={wallet} value={wallet}>
              {wallet.slice(0, 12)}...{wallet.slice(-8)}
            </option>
          ))}
        </select>
        <button
          onClick={handleAddLike}
          disabled={!selectedLiker || loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {loading ? 'Adding...' : 'Add Like'}
        </button>
      </div>
    </div>
  );
}

// Submission form component
function SubmissionForm({
  onSubmit,
  loading,
  onCancel
}: {
  onSubmit: (data: FormData) => void;
  loading: boolean;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    chainId: '',
    walletAddress: '',
    signatureR: '',
    signatureS: '',
    tagline: '',
  });
  const [image, setImage] = useState<File | null>(null);
  const [generatingCredentials, setGeneratingCredentials] = useState(false);
  const [chains, setChains] = useState<Chain[]>([]);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadChains = async () => {
      try {
        const data = await api.chains.list();
        setChains(data);
      } catch (error) {
        console.error('Failed to load chains:', error);
        setError('Failed to load chains');
      }
    };
    loadChains();
  }, []);

  const handleGenerateCredentials = async () => {
    if (!image) {
      setError('Please select an image first');
      return;
    }

    setError('');
    setGeneratingCredentials(true);
    try {
      const data = new FormData();
      data.append('image', image);

      const response = await fetch('/api/generate-credentials', {
        method: 'POST',
        body: data,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Failed to generate credentials');
      }

      const result = await response.json();
      setFormData({
        ...formData,
        walletAddress: result.walletAddress,
        signatureR: result.signatureR,
        signatureS: result.signatureS,
      });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setGeneratingCredentials(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!image) {
      setError('Please select an image');
      return;
    }

    if (!formData.walletAddress || !formData.signatureR || !formData.signatureS) {
      setError('Please generate credentials first');
      return;
    }

    setError('');
    const data = new FormData();
    data.append('image', image);
    data.append('chainId', formData.chainId);
    data.append('walletAddress', formData.walletAddress);
    data.append('signatureR', formData.signatureR);
    data.append('signatureS', formData.signatureS);
    if (formData.tagline) {
      data.append('tagline', formData.tagline);
    }

    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Image *
        </label>
        <input
          type="file"
          accept="image/*"
          required
          onChange={(e) => {
            setImage(e.target.files?.[0] || null);
            setError('');
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <p className="mt-1 text-sm text-gray-500">
          Select an image, then generate test credentials
        </p>
      </div>

      <button
        type="button"
        onClick={handleGenerateCredentials}
        disabled={!image || generatingCredentials}
        className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {generatingCredentials ? 'Generating...' : 'Generate Test Credentials'}
      </button>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Chain *
        </label>
        <select
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          value={formData.chainId}
          onChange={(e) => setFormData({ ...formData, chainId: e.target.value })}
        >
          <option value="">Select a chain</option>
          {chains.map((chain) => (
            <option key={chain.id} value={chain.id}>
              {chain.name} ({chain.length} submissions)
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Wallet Address (Public Key) *
        </label>
        <input
          type="text"
          placeholder="Generated from credentials"
          required
          readOnly
          className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 font-mono text-sm"
          value={formData.walletAddress}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          ECDSA Signature *
        </label>
        <input
          type="text"
          placeholder="Generated from credentials"
          required
          readOnly
          className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 font-mono text-sm"
          value={formData.signatureR ? '✓ Credentials generated' : ''}
        />
        {formData.signatureR && (
          <p className="mt-1 text-xs text-gray-500">
            ECDSA signature components (R, S) generated
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tagline
        </label>
        <input
          type="text"
          placeholder="Add an optional tagline"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          value={formData.tagline}
          onChange={(e) => setFormData({ ...formData, tagline: e.target.value })}
        />
      </div>

      <div className="flex justify-end space-x-4 pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || !formData.walletAddress || !formData.signatureR}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Creating...' : 'Create Submission'}
        </button>
      </div>
    </form>
  );
}
