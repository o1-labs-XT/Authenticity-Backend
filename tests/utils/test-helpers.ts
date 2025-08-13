import { DatabaseConnection } from '../../src/db/database';
import { AuthenticityRepository } from '../../src/db/repositories/authenticity.repository';
import { Express } from 'express';
import { createServer } from '../../src/api/server';
import { UploadHandler } from '../../src/handlers/upload.handler';
import { StatusHandler } from '../../src/handlers/status.handler';
import { TokenOwnerHandler } from '../../src/handlers/tokenOwner.handler';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Create a test database connection
 */
export function createTestDatabase(): DatabaseConnection {
  return new DatabaseConnection({
    path: ':memory:',
    verbose: false,
  });
}

/**
 * Create a test repository
 */
export function createTestRepository(db?: DatabaseConnection): AuthenticityRepository {
  const database = db || createTestDatabase();
  return new AuthenticityRepository(database.getDb());
}

/**
 * Create a test Express app with mocked handlers
 */
export function createTestApp(handlers: {
  uploadHandler: UploadHandler;
  statusHandler: StatusHandler;
  tokenOwnerHandler: TokenOwnerHandler;
}): Express {
  return createServer(handlers);
}

/**
 * Generate a random SHA256 hash
 */
export function generateRandomHash(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a random Mina public key (base58)
 */
export function generateRandomPublicKey(): string {
  // Simplified - real Mina keys have specific format
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = 'B62';
  for (let i = 0; i < 52; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Generate a random signature (base58)
 */
export function generateRandomSignature(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 100; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Create a test image file
 */
export function createTestImage(): { path: string; buffer: Buffer; cleanup: () => void } {
  const buffer = Buffer.from('test image data');
  const imagePath = path.join('/tmp', `test-image-${Date.now()}.png`);
  fs.writeFileSync(imagePath, buffer);
  
  return {
    path: imagePath,
    buffer,
    cleanup: () => {
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    },
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error('Timeout waiting for condition');
}

/**
 * Create mock authenticity record data
 */
export function createMockAuthenticityRecord(overrides?: Partial<any>) {
  return {
    sha256Hash: generateRandomHash(),
    tokenOwnerAddress: generateRandomPublicKey(),
    creatorPublicKey: generateRandomPublicKey(),
    signature: generateRandomSignature(),
    status: 'pending',
    ...overrides,
  };
}

/**
 * Clean up test resources
 */
export class TestCleanup {
  private cleanups: Array<() => void | Promise<void>> = [];

  add(cleanup: () => void | Promise<void>): void {
    this.cleanups.push(cleanup);
  }

  async execute(): Promise<void> {
    for (const cleanup of this.cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
    this.cleanups = [];
  }
}