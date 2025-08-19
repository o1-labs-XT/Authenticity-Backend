import Client from 'mina-signer';

// Test with the EXACT signature from Auro
async function test() {
  // This is the exact data from your Auro signature
  const message = '5c29e62db19bcba50e4d2e70ffe2fbf1f09d7b824a19ff368b3999ca7eb4d520';
  const publicKey = 'B62qogLDuD71AdygV9FfE6CQeQaxYFB6foz3ws2QyFRp6nUq3bcU9Hg';
  const signature = {
    field: '8660910932301733673637012779087279199930911829634094429051810497941593281870',
    scalar: '23933010921217988921018488817826438500073196235057054857045214496902806424389'
  };
  
  console.log('Testing Auro signature verification with different networks:');
  console.log('Message:', message);
  console.log('PublicKey:', publicKey);
  console.log('Signature:', signature);
  console.log('');
  
  // Test with different networks
  const networks = ['mainnet', 'devnet', 'testnet'];
  
  for (const network of networks) {
    const client = new Client({ network });
    
    try {
      const isValid = client.verifyMessage({
        data: message,
        signature: signature,
        publicKey: publicKey
      });
      
      console.log(`Network '${network}': ${isValid ? '✅ VALID' : '❌ INVALID'}`);
    } catch (error) {
      console.log(`Network '${network}': ❌ ERROR - ${error.message}`);
    }
  }
  
  // Also test if Auro might be signing something else
  console.log('\nTesting if Auro might have signed a different format:');
  
  // Test if it signed the JSON array we were sending before
  const jsonArrayMessage = '["92","41","230","45","177","155","203","165","14","77","46","112","255","226","251","241","240","15","157","123","130","74","25","255","54","139","57","153","202","126","180","213","32"]';
  
  for (const network of networks) {
    const client = new Client({ network });
    
    try {
      const isValid = client.verifyMessage({
        data: jsonArrayMessage.substring(0, 100), // Test partial
        signature: signature,
        publicKey: publicKey
      });
      
      if (isValid) {
        console.log(`Network '${network}' with JSON array: ✅ VALID`);
      }
    } catch (error) {
      // Silent fail for this test
    }
  }
}

test().catch(console.error);