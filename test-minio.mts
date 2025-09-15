#!/usr/bin/env tsx

import { S3Client, ListBucketsCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

// Get MinIO credentials from environment or prompt user
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:9000');

const MINIO_ACCESS_KEY = process.env.MINIO_ROOT_USER || process.env.MINIO_ACCESS_KEY;
const MINIO_SECRET_KEY = process.env.MINIO_ROOT_PASSWORD || process.env.MINIO_SECRET_KEY;

if (!MINIO_ACCESS_KEY || !MINIO_SECRET_KEY) {
  console.error('❌ MinIO credentials not found!');
  console.error('\nPlease set these environment variables:');
  console.error('  - MINIO_ROOT_USER or MINIO_ACCESS_KEY');
  console.error('  - MINIO_ROOT_PASSWORD or MINIO_SECRET_KEY');
  console.error('\nYou can find these in your Railway MinIO service variables.');
  console.error('\nExample:');
  console.error('  MINIO_ROOT_USER=xxx MINIO_ROOT_PASSWORD=yyy tsx test-minio.mts');
  process.exit(1);
}

console.log('🔧 Testing MinIO connection...');
console.log(`📍 Endpoint: ${MINIO_ENDPOINT}`);
console.log(`🔑 Access Key: ${MINIO_ACCESS_KEY.substring(0, 4)}...`);

// Create S3 client with MinIO configuration
const client = new S3Client({
  endpoint: MINIO_ENDPOINT,
  region: 'us-east-1', // MinIO requires this but ignores it
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: true, // Required for MinIO
});

async function testMinIO() {
  try {
    // Test 1: List buckets
    console.log('\n📦 Listing buckets...');
    const { Buckets } = await client.send(new ListBucketsCommand({}));

    if (Buckets && Buckets.length > 0) {
      console.log('✅ Found buckets:');
      Buckets.forEach(bucket => {
        console.log(`   - ${bucket.Name} (created: ${bucket.CreationDate})`);
      });
    } else {
      console.log('📭 No buckets found (this is normal for fresh installation)');
    }

    // Test 2: Create or verify authenticity-images bucket
    const bucketName = 'authenticity-images';
    console.log(`\n🪣 Checking bucket "${bucketName}"...`);

    try {
      await client.send(new HeadBucketCommand({ Bucket: bucketName }));
      console.log(`✅ Bucket "${bucketName}" exists`);
    } catch (error) {
      console.log(`📝 Creating bucket "${bucketName}"...`);
      await client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`✅ Bucket "${bucketName}" created`);
    }

    // Test 3: Upload a test object
    console.log('\n📤 Uploading test object...');
    const testKey = 'test/connection-test.txt';
    const testContent = `MinIO connection test - ${new Date().toISOString()}`;

    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: testKey,
      Body: Buffer.from(testContent),
      ContentType: 'text/plain',
    }));
    console.log(`✅ Uploaded: ${testKey}`);

    // Test 4: Download the test object
    console.log('\n📥 Downloading test object...');
    const getResponse = await client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: testKey,
    }));

    const downloadedContent = await streamToString(getResponse.Body);
    console.log(`✅ Downloaded content: "${downloadedContent}"`);

    if (downloadedContent === testContent) {
      console.log('✅ Content matches!');
    } else {
      console.log('⚠️  Content mismatch!');
    }

    // Success!
    console.log('\n🎉 MinIO is working correctly!');
    console.log('\n📋 Next steps:');
    console.log('1. Add these environment variables to your Railway services:');
    console.log(`   MINIO_ENDPOINT=${MINIO_ENDPOINT}`);
    console.log(`   MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}`);
    console.log(`   MINIO_SECRET_KEY=${MINIO_SECRET_KEY}`);
    console.log(`   MINIO_BUCKET=${bucketName}`);
    console.log('   MINIO_REGION=us-east-1');
    console.log('\n2. For internal Railway communication, use:');
    console.log('   MINIO_ENDPOINT=http://<your-minio-service>.railway.internal:9000');
    console.log('\n3. The MinIO console should be available at:');
    console.log(`   ${MINIO_ENDPOINT.replace(':9000', ':9001')}`);

  } catch (error) {
    console.error('\n❌ MinIO test failed!');
    console.error(error);

    if (error.name === 'NetworkingError') {
      console.error('\n🔍 Troubleshooting tips:');
      console.error('1. Check if MinIO service is running in Railway');
      console.error('2. Verify the endpoint URL is correct');
      console.error('3. If using public domain, ensure it includes https://');
      console.error('4. Check Railway logs for the MinIO service');
    } else if (error.name === 'InvalidUserCredentials' || error.Code === 'InvalidAccessKeyId') {
      console.error('\n🔍 Troubleshooting tips:');
      console.error('1. Check MinIO service environment variables in Railway');
      console.error('2. Look for MINIO_ROOT_USER and MINIO_ROOT_PASSWORD');
      console.error('3. Make sure you copied them correctly');
    }

    process.exit(1);
  }
}

// Helper function to convert stream to string
async function streamToString(stream: any): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// Run the test
testMinIO().catch(console.error);