#!/usr/bin/env tsx

import { PrivateKey, Signature } from 'o1js';
import { prepareImageVerification, hashImageOffCircuit } from 'authenticity-zkapp';
import FormData from 'form-data';
import axios from 'axios';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const INTERVAL_MS = 90 * 1000; // 90 seconds

async function generateRandomImage(): Promise<string> {
  // Generate random image data (1KB of random bytes)
  const randomData = crypto.randomBytes(1024);
  
  // Save to temp file
  const tempFile = join(tmpdir(), `test-image-${Date.now()}.bin`);
  await fs.writeFile(tempFile, randomData);
  
  return tempFile;
}

async function uploadSignedImage(): Promise<void> {
  let tempFile: string | null = null;
  
  try {
    console.log('🎲 Generating random image...');
    tempFile = await generateRandomImage();
    
    console.log('🔑 Creating random keypair...');
    const privateKey = PrivateKey.random();
    const publicKey = privateKey.toPublicKey();
    
    console.log('📝 Signing image...');
    const imageData = await fs.readFile(tempFile);
    const imageHash = hashImageOffCircuit(imageData);
    const verificationInputs = prepareImageVerification(tempFile);
    const signature = Signature.create(privateKey, verificationInputs.expectedHash.toFields());
    
    console.log('📤 Uploading to API...');
    const form = new FormData();
    form.append('image', await fs.readFile(tempFile), {
      filename: 'test-image.bin',
      contentType: 'application/octet-stream'
    });
    form.append('publicKey', publicKey.toBase58());
    form.append('signature', signature.toBase58());
    
    const response = await axios.post(`${API_URL}/api/upload`, form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 30000
    });
    
    console.log('✅ Upload successful:', {
      tokenOwnerAddress: response.data.tokenOwnerAddress,
      status: response.data.status,
      sha256Hash: response.data.sha256Hash?.substring(0, 16) + '...'
    });
    
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    if (axios.isAxiosError(error) && error.response) {
      console.error('Response:', error.response.data);
    }
  } finally {
    // Clean up temp file
    if (tempFile) {
      try {
        await fs.unlink(tempFile);
      } catch (cleanupError) {
        console.warn('⚠️  Failed to cleanup temp file:', cleanupError.message);
      }
    }
  }
}

async function runDaemon(): Promise<void> {
  console.log('🚀 Starting upload daemon...');
  console.log(`📍 API URL: ${API_URL}`);
  console.log(`⏰ Upload interval: ${INTERVAL_MS / 1000} seconds`);
  console.log('');
  
  let uploadCount = 0;
  
  while (true) {
    uploadCount++;
    console.log(`\n📋 Upload #${uploadCount} - ${new Date().toISOString()}`);
    
    await uploadSignedImage();
    
    console.log(`⏳ Waiting ${INTERVAL_MS / 1000} seconds until next upload...`);
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down daemon...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down daemon...');
  process.exit(0);
});

// Start the daemon
runDaemon().catch(error => {
  console.error('💥 Daemon crashed:', error);
  process.exit(1);
});