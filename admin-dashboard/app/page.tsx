'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import type { Challenge, JobStats } from '@/lib/types';
import Card from '@/components/Card';

export default function Dashboard() {
  const [activeChallenges, setActiveChallenges] = useState<Challenge[]>([]);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const [challenges, jobs] = await Promise.all([
        api.challenges.getActive(),
        api.jobs.stats()
      ]);
      setActiveChallenges(challenges);
      setJobStats(jobs);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    }
  };

  const queueStats = jobStats?.queue ?? { created: 0, active: 0, completed: 0, failed: 0 };

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard title="Active Challenges" value={activeChallenges.length} />
        <StatCard title="Jobs in Queue" value={queueStats.active} color="blue" />
        <StatCard title="Failed Jobs" value={queueStats.failed} color="red" />
      </div>

      {/* Active Challenges */}
      <Card
        title="Active Challenges"
        className="mb-8"
        actions={
          <Link href="/challenges" className="text-blue-600 hover:text-blue-700">
            View All →
          </Link>
        }
      >
        {activeChallenges.length === 0 ? (
          <p className="text-gray-500">No active challenges</p>
        ) : (
          <div className="space-y-4">
            {activeChallenges.map((challenge) => (
              <div key={challenge.id} className="border rounded-lg p-4">
                <h3 className="font-semibold">{challenge.title}</h3>
                <p className="text-gray-600 text-sm mt-1">{challenge.description}</p>
                <p className="text-xs text-gray-500 mt-2">
                  Ends: {new Date(challenge.endTime).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Quick Actions */}
      <Card title="Quick Actions">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { href: '/challenges', label: 'Manage Challenges', color: 'blue' },
            { href: '/users', label: 'Manage Users', color: 'green' },
            { href: '/chains', label: 'View Chains', color: 'purple' },
            { href: '/jobs', label: 'View Jobs', color: 'yellow' },
          ].map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={`bg-${action.color}-600 text-white px-4 py-2 rounded hover:bg-${action.color}-700 text-center`}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </Card>
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
      'text-gray-900';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-sm font-medium text-gray-500 mb-2">{title}</h2>
      <p className={`text-3xl font-bold ${textColor}`}>{value}</p>
    </div>
  );
}