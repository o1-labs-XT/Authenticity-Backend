#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import dotenv from 'dotenv';

// Import o1js for Mina keypair generation and signing
import { PrivateKey, Signature } from 'o1js';
// Import prepareImageVerification from authenticity-zkapp
import { prepareImageVerification, hashImageOffCircuit } from 'authenticity-zkapp';

dotenv.config();

// Configuration
// const API_URL = 'https://authenticity-backend-production.up.railway.app';
const API_URL = 'http://localhost:3000';
const IMAGE_PATH = process.env.IMAGE_PATH || '../../../Desktop/demo.png'; // Update this to your test image

console.log(`Using API URL: ${API_URL}`);

async function main(): Promise<void> {
  try {
    const privateKey = PrivateKey.random();
    const publicKey = privateKey.toPublicKey();

    console.log('Public Key:', publicKey.toBase58());
    console.log('Private Key:', privateKey.toBase58());

    const imageData = fs.readFileSync(IMAGE_PATH);
    const imageHash = hashImageOffCircuit(imageData);
    console.log(`📷 Image loaded: ${IMAGE_PATH}\n#️⃣ SHA-256 hash: ${imageHash}\n`);

    const verificationInputs = prepareImageVerification(IMAGE_PATH);

    const signature = Signature.create(privateKey, verificationInputs.expectedHash.toFields());

    // convert signature and public key to base58, will need to parse back into an object server side
    const form = new FormData();
    form.append('image', fs.createReadStream(IMAGE_PATH), {
      filename: path.basename(IMAGE_PATH),
      contentType: 'image/png',
    });
    form.append('publicKey', publicKey.toBase58());
    form.append('signature', signature.toBase58());

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
