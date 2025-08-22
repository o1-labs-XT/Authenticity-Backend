#!/usr/bin/env node
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';

console.log(`Using API URL: ${API_URL}`);

const headers = {
  'Content-Type': 'application/json',
  ...(ADMIN_KEY && { 'x-admin-key': ADMIN_KEY }),
};

async function getJobStats() {
  try {
    console.log('\n📊 Getting job statistics...');
    const response = await axios.get(`${API_URL}/api/admin/jobs/stats`, { headers });
    console.log('Job Queue Stats:', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('❌ Error getting job stats:', error.response?.data || error.message);
  }
}

async function getFailedJobs() {
  try {
    console.log('\n❌ Getting failed jobs...');
    const response = await axios.get(`${API_URL}/api/admin/jobs/failed?limit=5`, { headers });
    console.log('Failed Jobs:', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('❌ Error getting failed jobs:', error.response?.data || error.message);
  }
}

async function getJobDetails(jobId: string) {
  try {
    console.log(`\n🔍 Getting details for job ${jobId}...`);
    const response = await axios.get(`${API_URL}/api/admin/jobs/${jobId}`, { headers });
    console.log('Job Details:', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('❌ Error getting job details:', error.response?.data || error.message);
  }
}

async function retryJob(jobId: string) {
  try {
    console.log(`\n🔄 Retrying job ${jobId}...`);
    const response = await axios.post(`${API_URL}/api/admin/jobs/${jobId}/retry`, {}, { headers });
    console.log('Retry Result:', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('❌ Error retrying job:', error.response?.data || error.message);
  }
}

async function main() {
  const command = process.argv[2];
  const jobId = process.argv[3];

  switch (command) {
    case 'stats':
      await getJobStats();
      break;
    case 'failed':
      await getFailedJobs();
      break;
    case 'details':
      if (!jobId) {
        console.error('Please provide a job ID');
        process.exit(1);
      }
      await getJobDetails(jobId);
      break;
    case 'retry':
      if (!jobId) {
        console.error('Please provide a job ID');
        process.exit(1);
      }
      await retryJob(jobId);
      break;
    default:
      console.log('Usage:');
      console.log('  tsx test-admin.mts stats              - Get job queue statistics');
      console.log('  tsx test-admin.mts failed             - Get failed jobs');
      console.log('  tsx test-admin.mts details <jobId>    - Get job details');
      console.log('  tsx test-admin.mts retry <jobId>      - Retry a failed job');
      console.log('');
      console.log('Environment variables:');
      console.log('  API_URL         - API endpoint (default: http://localhost:3000)');
      console.log('  ADMIN_API_KEY   - Admin API key for production');
  }
}

main().catch(console.error);