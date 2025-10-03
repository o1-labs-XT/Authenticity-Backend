#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import dotenv from 'dotenv';

// Import ECDSA functionality from authenticity-zkapp
import { generateECKeyPair, computeOnChainCommitment, Ecdsa } from 'authenticity-zkapp';

dotenv.config();

// Configuration
// const API_URL = 'https://authenticity-backend-production.up.railway.app';
// const API_URL = 'https://authenticity-api-staging.up.railway.app';
const API_URL = 'http://localhost:3000';
const IMAGE_PATH = process.env.IMAGE_PATH || '../../../Desktop/demo.png'; // Update this to your test image

console.log(`Using API URL: ${API_URL}`);

async function main(): Promise<void> {
  try {
    // Generate ECDSA keypair
    const keyPair = generateECKeyPair();

    console.log('Public Key X:', keyPair.publicKeyXHex);
    console.log('Public Key Y:', keyPair.publicKeyYHex);
    console.log('Private Key:', keyPair.privateKeyHex);

    const imageData = fs.readFileSync(IMAGE_PATH);
    const commitment = await computeOnChainCommitment(imageData);
    console.log(`📷 Image loaded: ${IMAGE_PATH}\n#️⃣ SHA-256 hash: ${commitment.sha256}\n`);

    // Create Bytes32 from the hash (this is what the server expects to verify against)
    const { Bytes32 } = await import('authenticity-zkapp');
    const commitmentBytes = Bytes32.fromHex(commitment.sha256);

    // Create ECDSA signature using signHash since the server uses verifySignedHash
    const signature = Ecdsa.signHash(commitmentBytes, keyPair.privateKeyBigInt);

    // Extract bigint values from the signature components
    const signatureData = signature.toBigInt();
    const signatureR = signatureData.r.toString(16).padStart(64, '0');
    const signatureS = signatureData.s.toString(16).padStart(64, '0');

    // Create multipart form with ECDSA signature components
    const form = new FormData();
    form.append('image', fs.createReadStream(IMAGE_PATH), {
      filename: path.basename(IMAGE_PATH),
      contentType: 'image/png',
    });
    form.append('signatureR', signatureR);
    form.append('signatureS', signatureS);
    form.append('publicKeyX', keyPair.publicKeyXHex);
    form.append('publicKeyY', keyPair.publicKeyYHex);

    const response = await axios.post(`${API_URL}/api/upload`, form, {
      headers: {
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    console.log(response.data);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    process.exit(1);
  }
}

main();
