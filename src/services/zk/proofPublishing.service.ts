import { AuthenticityZkApp } from 'authenticity-zkapp';
import { Mina, PublicKey, PrivateKey, AccountUpdate, Field } from 'o1js';
import { ProofPublishingTask } from '../../types';

export class ProofPublishingService {
  private zkApp: AuthenticityZkApp | null = null;
  private compiled = false;
  private compiling = false;
  private zkAppAddress: string;
  private deployerKey: string;
  private feePayerKey: string;

  constructor(
    zkAppAddress: string,
    deployerKey: string,
    feePayerKey: string,
    network: string = 'testnet'
  ) {
    this.zkAppAddress = zkAppAddress;
    this.deployerKey = deployerKey;
    this.feePayerKey = feePayerKey;

    // Initialize network
    this.setupNetwork(network);
    
    // Initialize zkApp instance if address is provided
    if (zkAppAddress) {
      try {
        const zkAppPublicKey = PublicKey.fromBase58(this.zkAppAddress);
        this.zkApp = new AuthenticityZkApp(zkAppPublicKey);
        console.log(`ProofPublishingService initialized with zkApp at ${zkAppAddress}`);
      } catch {
        console.warn(`Invalid zkApp address provided: ${zkAppAddress}`);
      }
    }
  }

  /**
   * Setup the Mina network connection
   */
  private setupNetwork(network: string): void {
    if (network === 'testnet') {
      const Berkeley = Mina.Network(
        'https://api.minascan.io/node/devnet/v1/graphql'
      );
      Mina.setActiveInstance(Berkeley);
      console.log('Connected to Mina testnet');
    } else if (network === 'mainnet') {
      const Mainnet = Mina.Network(
        'https://api.minascan.io/node/mainnet/v1/graphql'
      );
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
        await new Promise(resolve => setTimeout(resolve, 100));
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
    const tokenOwner = PublicKey.fromBase58(task.tokenOwnerAddress);
    const creator = PublicKey.fromBase58(task.creatorPublicKey);
    const feePayer = PrivateKey.fromBase58(this.feePayerKey);
    
    console.log('Creating transaction to publish proof...');
    
    try {
      // Create transaction to verify and store the proof on-chain
      const txn = await Mina.transaction(
        feePayer.toPublicKey(),
        async () => {
          // Fund the new token account
          AccountUpdate.fundNewAccount(feePayer.toPublicKey());
          
          // Call verifyAndStore on the zkApp
          // This will:
          // 1. Verify the AuthenticityProgram proof
          // 2. Deploy a token account with state storing:
          //    - Poseidon hash of the image commitment
          //    - Creator public key (x coord and isOdd)
          await this.zkApp!.verifyAndStore(
            tokenOwner,
            creator,
            task.proof,
            task.publicInputs
          );
        }
      );

      console.log('Proving transaction...');
      await txn.prove();

      console.log('Signing and sending transaction...');
      const pendingTxn = await txn.sign([feePayer]).send();

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
      return false;
    }

    try {
      const zkAppPublicKey = PublicKey.fromBase58(this.zkAppAddress);
      const account = Mina.getAccount(zkAppPublicKey);
      return !!account.zkapp;
    } catch {
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