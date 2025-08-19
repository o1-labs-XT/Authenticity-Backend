import { AuthenticityZkApp, AuthenticityProof, AuthenticityInputs } from 'authenticity-zkapp';
import { Mina, PublicKey, PrivateKey, AccountUpdate, fetchAccount } from 'o1js';

export class ProofPublishingService {
  private zkApp: AuthenticityZkApp;
  private zkAppAddress: string;
  private feePayerKey: string;

  constructor(zkAppAddress: string, feePayerKey: string, network: string) {
    this.zkAppAddress = zkAppAddress;
    this.feePayerKey = feePayerKey;

    // Initialize network
    this.setupNetwork(network);

    // Initialize zkApp instance - will throw if address is invalid
    const zkAppPublicKey = PublicKey.fromBase58(this.zkAppAddress);
    this.zkApp = new AuthenticityZkApp(zkAppPublicKey);
    console.log(`ProofPublishingService initialized with zkApp at ${zkAppAddress}`);
  }

  /**
   * Setup the Mina network connection
   * todo: refactor
   */
  private setupNetwork(network: string): void {
    if (network === 'testnet') {
      const Testnet = Mina.Network({
        networkId: 'testnet',
        mina: 'https://api.minascan.io/node/devnet/v1/graphql',
      });
      Mina.setActiveInstance(Testnet);
      console.log(
        'Connected to Mina testnet (devnet) at: https://api.minascan.io/node/devnet/v1/graphql'
      );
    } else if (network === 'mainnet') {
      const Mainnet = Mina.Network('https://api.minascan.io/node/mainnet/v1/graphql');
      Mina.setActiveInstance(Mainnet);
      console.log('Connected to Mina mainnet');
    } 
  }

  /**
   * Publish a proof of authenticity to the blockchain
   * This calls the deployed AuthenticityZkApp.verifyAndStore method
   */
  async publishProof(
    sha256Hash: string,
    proof: AuthenticityProof,
    publicInputs: AuthenticityInputs,
    tokenOwnerPrivateKey: string
  ): Promise<string> {
    // Check if zkApp is deployed
    const isDeployed = await this.isDeployed();
    if (!isDeployed) {
      throw new Error('AuthenticityZkApp is not deployed. Please deploy the contract first.');
    }

    if (!this.feePayerKey) {
      throw new Error('Fee payer private key not configured');
    }

    console.log(`Publishing proof for SHA256: ${sha256Hash}`);

    // Ensure contract is compiled (o1js caches this internally)
    await AuthenticityZkApp.compile();

    // Parse addresses and keys
    const tokenOwnerPrivate = PrivateKey.fromBase58(tokenOwnerPrivateKey);
    const tokenOwner = tokenOwnerPrivate.toPublicKey();
    const feePayer = PrivateKey.fromBase58(this.feePayerKey);

    console.log('Transaction participants:');
    console.log('- Fee payer:', feePayer.toPublicKey().toBase58());
    console.log('- Token owner:', tokenOwner.toBase58());
    console.log('- Creator (from proof):',  proof.publicInput.publicKey.toBase58());

    console.log('Creating transaction to publish proof...');

    try {
      // Create transaction to verify and store the proof on-chain
      const txn = await Mina.transaction({ sender: feePayer.toPublicKey(), fee: 1e9 }, async () => {
        // Fund the new token account
        AccountUpdate.fundNewAccount(feePayer.toPublicKey());

        // Call verifyAndStore on the zkApp
        // Pass the actual token owner address (not fee payer)
        await this.zkApp.verifyAndStore(tokenOwner, proof, publicInputs);
      });

      console.log('Proving transaction...');
      await txn.prove();

      console.log('Signing and sending transaction...');
      // Sign with all required parties:
      // 1. Fee payer (for paying fees)
      // 2. Token owner (for the new token account)
      const signers = [feePayer, tokenOwnerPrivate];
      console.log(`Signing transaction with ${signers.length} signers`);
      const pendingTxn = await txn.sign(signers).send();

      console.log(`Transaction sent with hash: ${pendingTxn.hash}`);

      // Wait for confirmation (optional - could be async)
      if (pendingTxn.wait) {
        console.log('Waiting for transaction confirmation...');
        await pendingTxn.wait();
        console.log('Transaction confirmed on blockchain');
      }

      return pendingTxn.hash;
    } catch (error: any) {
      console.error('Failed to publish proof:', error);
      throw new Error(`Failed to publish proof: ${error.message}`);
    }
  }

  /**
   * Check if the zkApp is deployed and ready
   */
  async isDeployed(): Promise<boolean> {
    try {
      const zkAppPublicKey = PublicKey.fromBase58(this.zkAppAddress);
      console.log(`Checking deployment for zkApp at: ${this.zkAppAddress}`);

      await fetchAccount({ publicKey: zkAppPublicKey });
      const account = Mina.getAccount(zkAppPublicKey);
      console.log('Account fetched:', {
        address: zkAppPublicKey.toBase58(),
        balance: account.balance.toString(),
        nonce: account.nonce.toString(),
        hasZkapp: !!account.zkapp,
        zkappState: account.zkapp?.appState?.map((s) => s.toString()),
      });

      return !!account.zkapp;
    } catch (error: any) {
      console.error('Error checking deployment:', error.message);
      return false;
    }
  }
}
