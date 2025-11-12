#!/usr/bin/env node
import { AuthenticityProgram, AuthenticityZkApp, BatchReducerUtils } from 'authenticity-zkapp';
import { Cache, PublicKey } from 'o1js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const CACHE_DIR = process.env.CIRCUIT_CACHE_PATH || './cache';

async function compileZkApp(): Promise<void> {
  console.log('🔧 Pre-compiling zkApp circuit...');

  // Clear existing cache directory (keeping .gitkeep)
  const cachePath = path.resolve(CACHE_DIR);
  if (fs.existsSync(cachePath)) {
    console.log(`📁 Clearing existing cache directory: ${cachePath}`);
    const files = fs.readdirSync(cachePath);
    for (const file of files) {
      if (file !== '.gitkeep') {
        const filePath = path.join(cachePath, file);
        fs.rmSync(filePath, { recursive: true, force: true });
      }
    }
  }

  // Create fresh cache directory
  console.log(`📁 Creating cache directory: ${cachePath}`);
  fs.mkdirSync(cachePath, { recursive: true });

  try {
    console.log('⏳ Compiling Artifacts...');
    const startTime = Date.now();

    // Create cache instance and compile
    const cache = Cache.FileSystem(cachePath);
    console.log('Compiling BatchReducer...');
    if (!process.env.ZKAPP_ADDRESS) {
      throw new Error('ZKAPP_ADDRESS environment variable not set');
    }
    const zkAppAddress = PublicKey.fromBase58(process.env.ZKAPP_ADDRESS);
    // Note: we set the contract instance here, even though there is more than one contract (each challenge has its own zkApp)
    // This is ok as long as we never actually call the batch reducer on any of the zkapps
    // This is just a vestige from when we were going to use the reducer to keep score, and it's safe to ignore.
    BatchReducerUtils.setContractInstance(new AuthenticityZkApp(zkAppAddress));
    await BatchReducerUtils.compile();
    console.log('Compiling AuthenticityProgram...');
    await AuthenticityProgram.compile({ cache });
    console.log('Compiling AuthenticityZkApp...');
    await AuthenticityZkApp.compile({ cache });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Circuit compilation completed in ${duration}s`);
    console.log(`📦 Compilation artifacts cached in: ${cachePath}`);

    // Verify cache was created
    const cacheFiles = fs.readdirSync(cachePath);
    console.log(`📊 Cache contains ${cacheFiles.length} files`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to compile zkApp circuit:', error);
    process.exit(1);
  }
}

// Run compilation
compileZkApp().catch((error) => {
  console.error('❌ Compilation script failed:', error);
  process.exit(1);
});
