import { AuthenticityZkApp } from 'authenticity-zkapp';
import { Mina, PublicKey, PrivateKey, AccountUpdate, Field, fetchAccount } from 'o1js';
import { ProofPublishingTask } from '../../types/index.js';

export class ProofPublishingService {
  private zkApp: AuthenticityZkApp | null = null;
  private compiled = false;
  private compiling = false;
  private zkAppAddress: string; 
  private feePayerKey: string;

  constructor(
    zkAppAddress: string, 
    feePayerKey: string,
    network: string = 'testnet'
  ) {
    this.zkAppAddress = zkAppAddress; 
    this.feePayerKey = feePayerKey;

    // Initialize network
    this.setupNetwork(network);

    // Initialize zkApp instance if address is provided
    if (zkAppAddress) {
      try {
        const zkAppPublicKey = PublicKey.fromBase58(this.zkAppAddress);
        this.zkApp = new AuthenticityZkApp(zkAppPublicKey);
        console.log(`ProofPublishingService initialized with zkApp at ${zkAppAddress}`);
        console.log(`zkApp instance created:`, !!this.zkApp);
      } catch (error: any) {
        console.error(`Failed to create zkApp instance: ${error.message}`);
        console.warn(`Invalid zkApp address provided: ${zkAppAddress}`);
      }
    } else {
      console.warn('No zkApp address provided to ProofPublishingService');
    }
  }

  /**
   * Setup the Mina network connection
   */
  private setupNetwork(network: string): void {
    if (network === 'testnet') {
      const Berkeley = Mina.Network({
        networkId: 'devnet',
        mina: 'https://api.minascan.io/node/devnet/v1/graphql',
      });
      Mina.setActiveInstance(Berkeley);
      console.log(
        'Connected to Mina testnet (devnet) at: https://api.minascan.io/node/devnet/v1/graphql'
      );
    } else if (network === 'mainnet') {
      const Mainnet = Mina.Network('https://api.minascan.io/node/mainnet/v1/graphql');
      Mina.setActiveInstance(Mainnet);
      console.log('Connected to Mina mainnet');
    } else {
      // Local blockchain for development
      console.log('Using local Mina blockchain');
      // Note: Local blockchain should be initialized in main app
    }
  }

  /**
   * Compile the AuthenticityZkApp contract
   * This should be done once at startup and cached
   */
  async compile(): Promise<void> {
    if (this.compiled) {
      return;
    }

    if (this.compiling) {
      // Wait for compilation to complete if already in progress
      while (this.compiling) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return;
    }

    this.compiling = true;

    try {
      console.log('Compiling AuthenticityZkApp...');
      const startTime = Date.now();

      await AuthenticityZkApp.compile();

      const compilationTime = Date.now() - startTime;
      console.log(`AuthenticityZkApp compiled successfully in ${compilationTime}ms`);

      this.compiled = true;
    } finally {
      this.compiling = false;
    }
  }

  /**
   * Publish a proof of authenticity to the blockchain
   * This calls the deployed AuthenticityZkApp.verifyAndStore method
   */
  async publishProof(task: ProofPublishingTask): Promise<string> {
    if (!this.zkApp) {
      throw new Error('zkApp not initialized. Please deploy the contract first.');
    }

    if (!this.feePayerKey) {
      throw new Error('Fee payer private key not configured');
    }

    console.log(`Publishing proof for SHA256: ${task.sha256Hash}`);

    // Ensure contract is compiled
    await this.compile();

    // Parse addresses and keys
    const tokenOwnerPrivate = PrivateKey.fromBase58(task.tokenOwnerPrivateKey);
    const tokenOwner = tokenOwnerPrivate.toPublicKey();
    const feePayer = PrivateKey.fromBase58(this.feePayerKey);

    const creatorPublicKey = task.proof.publicInput.publicKey;

    console.log('Transaction participants:');
    console.log('- Fee payer:', feePayer.toPublicKey().toBase58());
    console.log('- Token owner:', tokenOwner.toBase58());
    console.log('- Creator (from proof):', creatorPublicKey.toBase58());

    console.log('Creating transaction to publish proof...');

    try {
      // Create transaction to verify and store the proof on-chain
      const txn = await Mina.transaction({ sender: feePayer.toPublicKey(), fee: 1e9 }, async () => {
        // Fund the new token account
        AccountUpdate.fundNewAccount(feePayer.toPublicKey());

        // Call verifyAndStore on the zkApp
        // Pass the actual token owner address (not fee payer)
        await this.zkApp!.verifyAndStore(tokenOwner, task.proof, task.publicInputs);
      });

      console.log('Proving transaction...');
      await txn.prove();

      console.log('Signing and sending transaction...');
      // Sign with all required parties:
      // 1. Fee payer (for paying fees)
      // 2. Token owner (for the new token account)
      const signers = [feePayer];

      signers.push(tokenOwnerPrivate);

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
   * Get the token ID for the zkApp
   * This is used to identify token accounts created by this zkApp
   */
  getTokenId(): Field | null {
    if (!this.zkApp) {
      return null;
    }
    return this.zkApp.deriveTokenId();
  }

  /**
   * Check if the zkApp is deployed and ready
   */
  async isDeployed(): Promise<boolean> {
    if (!this.zkApp) {
      console.log('isDeployed check failed: zkApp instance is null');
      return false;
    }

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

  /**
   * Get compilation status
   */
  isCompiled(): boolean {
    return this.compiled;
  }
}
