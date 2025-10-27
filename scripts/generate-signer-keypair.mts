#!/usr/bin/env tsx
import { generateECKeyPair } from 'authenticity-zkapp';

/**
 * Generates an ECDSA keypair for use with image signature verification
 * Run this script to generate keys for SIGNER_PUBLIC_KEY and SIGNER_PRIVATE_KEY
 */
function main() {
  const keyPair = generateECKeyPair();

  console.log('\n=== Generated ECDSA Keypair for Image Signing ===\n');
  console.log('Copy these to your environment file:\n');
  console.log(`SIGNER_PUBLIC_KEY=${keyPair.publicKeyXHex},${keyPair.publicKeyYHex}`);
  console.log(`SIGNER_PRIVATE_KEY=${keyPair.privateKeyBigInt.toString()}\n`);
}

main();
