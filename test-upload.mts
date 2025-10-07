#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

// Import ECDSA functionality from authenticity-zkapp
import { generateECKeyPair, prepareImageVerification, Ecdsa, Secp256r1 } from 'authenticity-zkapp';

dotenv.config();

// Configuration
// const API_URL = 'https://authenticity-backend-production.up.railway.app';
// const API_URL = 'https://authenticity-api-staging.up.railway.app';
const API_URL = process.env.API_URL || 'http://localhost:3000';

async function generateRandomImage(): Promise<string> {
  // Generate random image data (1KB of random bytes)
  const randomData = crypto.randomBytes(1024);

  // Save to temp file
  const tempFile = join(tmpdir(), `test-image-${Date.now()}.bin`);
  await fs.promises.writeFile(tempFile, randomData);

  return tempFile;
}

console.log(`Using API URL: ${API_URL}`);

async function main(): Promise<void> {
  try {
    // Generate ECDSA keypair
    const keyPair = generateECKeyPair();

    console.log('Public Key X:', keyPair.publicKeyXHex);
    console.log('Public Key Y:', keyPair.publicKeyYHex);
    console.log('Private Key:', keyPair.privateKeyBigInt);

    const imageFile = await generateRandomImage();

    // Prepare image verification inputs (this gives us the correct hash format)
    const verificationInputs = prepareImageVerification(imageFile);
    console.log(
      `📷 Image loaded: ${imageFile}\n#️⃣ Expected hash: ${verificationInputs.expectedHash.toHex()}\n`
    );

    // Create ECDSA signature using the correct format from the example
    const creatorKey = Secp256r1.Scalar.from(keyPair.privateKeyBigInt);

    const signature = Ecdsa.signHash(verificationInputs.expectedHash, creatorKey.toBigInt());

    // Extract bigint values from the signature components
    const signatureData = signature.toBigInt();
    const signatureR = signatureData.r.toString(16).padStart(64, '0');
    const signatureS = signatureData.s.toString(16).padStart(64, '0');

    // Create multipart form with ECDSA signature components
    const form = new FormData();
    form.append('image', fs.createReadStream(imageFile), {
      filename: path.basename(imageFile) + '.png',
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
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    process.exit(1);
  }
}

main();
