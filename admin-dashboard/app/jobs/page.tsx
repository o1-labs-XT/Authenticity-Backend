'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { Job, JobStats } from '@/lib/types';
import Card from '@/components/Card';
import DataTable, { Column } from '@/components/DataTable';

export default function JobsPage() {
  const [stats, setStats] = useState<JobStats | null>(null);
  const [failedJobs, setFailedJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const limit = 10;

  const loadJobsData = useCallback(async () => {
    try {
      setError(null);
      const [statsData, failedData] = await Promise.all([
        api.jobs.stats(),
        api.jobs.failed(limit, page * limit)
      ]);
      setStats(statsData);
      setFailedJobs(failedData.jobs || []);
    } catch (error) {
      console.error('Failed to load jobs data:', error);
      setError('Failed to load jobs data. Please try again.');
    } finally {
      setInitialLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadJobsData();
  }, [loadJobsData]);

  const viewJobDetails = async (jobId: string) => {
    setLoading(true);
    try {
      const data = await api.jobs.details(jobId);
      setSelectedJob(data);
    } catch (error) {
      alert('Failed to load job details');
    } finally {
      setLoading(false);
    }
  };

  const retryJob = async (jobId: string) => {
    if (!confirm('Retry this job?')) return;
    setLoading(true);
    try {
      await api.jobs.retry(jobId);
      alert('Job queued for retry');
      await loadJobsData();
      setSelectedJob(null);
    } catch (error) {
      alert('Failed to retry job');
    } finally {
      setLoading(false);
    }
  };

  const queueStats = stats?.queue ?? { created: 0, active: 0, completed: 0, failed: 0 };

  const columns: Column<Job>[] = [
    {
      key: 'id' as keyof Job,
      label: 'Job ID',
      render: (job: Job) => <span className="font-mono text-sm">{job.id.slice(0, 8)}...</span>
    },
    {
      key: 'data' as keyof Job,
      label: 'SHA256 Hash',
      render: (job: Job) => (
        <span className="font-mono text-sm">
          {job.data?.sha256Hash?.slice(0, 16)}...
        </span>
      )
    },
    {
      key: 'retrycount' as keyof Job,
      label: 'Retry Count',
      render: (job: Job) => job.retrycount || 0
    },
    {
      key: 'createdon' as keyof Job,
      label: 'Failed At',
      render: (job: Job) =>
        new Date(job.completedon || job.createdon).toLocaleString()
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (job: Job) => (
        <div className="space-x-4">
          <button
            onClick={() => viewJobDetails(job.id)}
            className="text-blue-600 hover:text-blue-900"
          >
            View
          </button>
          <button
            onClick={() => retryJob(job.id)}
            className="text-yellow-600 hover:text-yellow-900"
          >
            Retry
          </button>
        </div>
      )
    }
  ];

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading jobs data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="text-red-600 mb-4">{error}</div>
        <button
          onClick={() => {
            setInitialLoading(true);
            loadJobsData();
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Jobs Queue</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <StatCard title="Created" value={queueStats.created} />
        <StatCard title="Active" value={queueStats.active} color="blue" />
        <StatCard title="Completed" value={queueStats.completed} color="green" />
        <StatCard title="Failed" value={queueStats.failed} color="red" />
g      </div>

      {/* Job Details Modal */}
      {selectedJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-semibold">Job Details</h2>
                <button
                  onClick={() => setSelectedJob(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Job ID</label>
                  <p className="font-mono text-sm">{selectedJob.id}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">State</label>
                  <p className="font-semibold">{selectedJob.state}</p>
                </div>
                {selectedJob.data && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Job Data</label>
                    <pre className="bg-gray-100 p-3 rounded text-xs overflow-x-auto">
                      {JSON.stringify(selectedJob.data, null, 2)}
                    </pre>
                  </div>
                )}
                {selectedJob.state === 'failed' && (
                  <button
                    onClick={() => retryJob(selectedJob.id)}
                    disabled={loading}
                    className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700 disabled:opacity-50"
                  >
                    {loading ? 'Retrying...' : 'Retry Job'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Failed Jobs */}
      <Card
        title="Failed Jobs"
        actions={
          failedJobs.length > 0 && (
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">Page {page + 1}</span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={failedJobs.length < limit}
                className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )
        }
      >
        <DataTable
          data={failedJobs}
          columns={columns}
          emptyMessage="No failed jobs"
        />
      </Card>

      <div className="mt-8 p-4 bg-yellow-50 rounded-lg">
        <h3 className="font-semibold text-yellow-900 mb-2">About Jobs Queue</h3>
        <ul className="text-sm text-yellow-800 space-y-1">
          <li>• Jobs are proof generation tasks queued when images are uploaded</li>
          <li>• Failed jobs can be retried up to 3 times</li>
          <li>• Jobs are processed by the worker service</li>
          <li>• Each job carries a correlation ID for distributed tracing</li>
          <li>• Jobs are retained for 24 hours for auditing</li>
        </ul>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  color = 'gray'
}: {
  title: string;
  value: number;
  color?: string;
}) {
  const textColor = color === 'red' ? 'text-red-600' :
                    color === 'blue' ? 'text-blue-600' :
                    color === 'green' ? 'text-green-600' :
                    'text-gray-900';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-sm font-medium text-gray-500 mb-2">{title}</h2>
      <p className={`text-3xl font-bold ${textColor}`}>{value}</p>
    </div>
  );
}