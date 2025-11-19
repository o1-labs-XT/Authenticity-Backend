#!/usr/bin/env node
import { AuthenticityProgram, AuthenticityZkApp } from 'authenticity-zkapp';
import { Cache } from 'o1js';
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
    // Create cache instance
    const cache = Cache.FileSystem(cachePath);

    // Compile AuthenticityProgram (dependency)
    console.log('📦 Compiling AuthenticityProgram...');

    await AuthenticityProgram.compile({ cache });

    // Compile AuthenticityZkApp
    console.log('📦 Compiling AuthenticityZkApp...');
    await AuthenticityZkApp.compile({ cache });
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
