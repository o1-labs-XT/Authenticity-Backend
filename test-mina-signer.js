import Client from 'mina-signer';

// Test if mina-signer can verify its own signatures
async function test() {
  const client = new Client({ network: 'devnet' });
  
  // Generate a test keypair
  const keypair = client.genKeys();
  console.log('Generated keypair:', {
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey.substring(0, 20) + '...'
  });
  
  // Test message - same SHA256 we're trying to sign
  const message = '5c29e62db19bcba50e4d2e70ffe2fbf1f09d7b824a19ff368b3999ca7eb4d520';
  console.log('Message to sign:', message);
  
  // Sign the message
  const signed = client.signMessage(message, keypair.privateKey);
  console.log('Signed result:', {
    signature: signed.signature,
    publicKey: signed.publicKey,
    data: signed.data
  });
  
  // Verify the signature
  const isValid = client.verifyMessage(signed);
  console.log('Self-verification result:', isValid);
  
  // Now test with the exact format we're using in backend
  const isValid2 = client.verifyMessage({
    data: message,
    signature: signed.signature,
    publicKey: signed.publicKey
  });
  console.log('Backend-format verification result:', isValid2);
  
  // Test with a different message (should fail)
  const isValid3 = client.verifyMessage({
    data: 'different_message',
    signature: signed.signature,
    publicKey: signed.publicKey
  });
  console.log('Different message verification (should be false):', isValid3);
}

test().catch(console.error);