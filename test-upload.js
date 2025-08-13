#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

// Import o1js for Mina keypair generation and signing
const { PrivateKey, Signature } = require('o1js');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const IMAGE_PATH = '/Users/hattyhattington/Desktop/demo.png';

async function main() {
  try {
    console.log('🔑 Generating Mina keypair...');
    
    // Generate a new Mina keypair
    const privateKey = PrivateKey.random();
    const publicKey = privateKey.toPublicKey();
    
    console.log('Public Key:', publicKey.toBase58());
    console.log('Private Key:', privateKey.toBase58());
    
    // Read the image file
    console.log('\n📁 Reading image file...');
    if (!fs.existsSync(IMAGE_PATH)) {
      throw new Error(`Image file not found at ${IMAGE_PATH}`);
    }
    
    const imageBuffer = fs.readFileSync(IMAGE_PATH);
    console.log('Image size:', (imageBuffer.length / 1024).toFixed(2), 'KB');
    
    // Calculate SHA256 hash of the image
    console.log('\n🔐 Calculating SHA256 hash...');
    const sha256Hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    console.log('SHA256 Hash:', sha256Hash);
    
    // Sign the SHA256 hash with the private key
    console.log('\n✍️  Signing the hash...');
    // For simplicity, we'll sign the hash as a single field element
    // In production, you'd want to properly convert the hash
    const { Field, Poseidon } = require('o1js');
    
    // Convert hash to Field element (using first 31 bytes for Field compatibility)
    const hashBigInt = BigInt('0x' + sha256Hash.substring(0, 62));
    const hashField = Field(hashBigInt);
    
    // Create signature using o1js
    const signature = Signature.create(privateKey, [hashField]);
    const signatureBase58 = signature.toBase58();
    console.log('Signature:', signatureBase58);
    
    // Prepare the upload request
    console.log('\n📤 Uploading to API...');
    const form = new FormData();
    form.append('image', fs.createReadStream(IMAGE_PATH), {
      filename: path.basename(IMAGE_PATH),
      contentType: 'image/png'
    });
    form.append('publicKey', publicKey.toBase58());
    form.append('signature', signatureBase58);
    
    // Make the API request
    const startTime = Date.now();
    const response = await axios.post(`${API_URL}/api/upload`, form, {
      headers: {
        ...form.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    const uploadTime = Date.now() - startTime;
    
    console.log('\n✅ Upload successful!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('Upload time:', uploadTime, 'ms');
    
    // Save credentials for future reference
    const credentials = {
      publicKey: publicKey.toBase58(),
      privateKey: privateKey.toBase58(),
      sha256Hash: sha256Hash,
      signature: signatureBase58,
      tokenOwnerAddress: response.data.tokenOwnerAddress,
      timestamp: new Date().toISOString()
    };
    
    const credentialsPath = path.join(__dirname, 'test-credentials.json');
    fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
    console.log('\n💾 Credentials saved to:', credentialsPath);
    
    // Poll for status
    if (response.data.status === 'pending') {
      console.log('\n⏳ Proof generation is pending. Polling for status...');
      await pollStatus(sha256Hash);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    process.exit(1);
  }
}

async function pollStatus(sha256Hash, maxAttempts = 10) {
  let attempts = 0;
  const delays = [2000, 4000, 8000, 16000, 30000]; // Exponential backoff
  
  while (attempts < maxAttempts) {
    attempts++;
    const delay = delays[Math.min(attempts - 1, delays.length - 1)];
    
    console.log(`\nAttempt ${attempts}/${maxAttempts} - Waiting ${delay/1000}s...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      const response = await axios.get(`${API_URL}/api/status/${sha256Hash}`);
      console.log('Status:', response.data.status);
      
      if (response.data.status === 'verified') {
        console.log('✅ Proof verified!');
        console.log('Transaction ID:', response.data.transactionId);
        return response.data;
      } else if (response.data.status === 'failed') {
        console.error('❌ Proof generation failed:', response.data.errorMessage);
        return response.data;
      }
      // Continue polling if still pending
    } catch (error) {
      console.error('Error checking status:', error.message);
    }
  }
  
  console.log('⏱️  Max polling attempts reached. Check status manually.');
}

// Check if axios and form-data are installed
function checkDependencies() {
  try {
    require('axios');
    require('form-data');
    require('o1js');
  } catch (error) {
    console.error('Missing dependencies. Please run:');
    console.error('npm install axios form-data o1js');
    process.exit(1);
  }
}

// Run the script
checkDependencies();
main();

// update test-upload to use the same signing logic as /Users/hattyhattington/code/o1labs/Authenticity-Zkapp/examples/backend. the signing logic we currently use causes the server to error with invalid signature for data
