import { Mina, PublicKey, Field } from 'o1js';
import { AuthenticityZkApp } from 'authenticity-zkapp';

export class ZkAppInteractionService {
  private network: string;
  private zkAppAddress?: string;
  private zkApp?: AuthenticityZkApp;

  constructor(network: string = 'testnet', zkAppAddress?: string) {
    this.network = network;
    this.zkAppAddress = zkAppAddress;
    this.setupNetwork();
    
    if (zkAppAddress) {
      try {
        const zkAppPublicKey = PublicKey.fromBase58(zkAppAddress);
        this.zkApp = new AuthenticityZkApp(zkAppPublicKey);
        console.log(`ZkAppInteractionService initialized with zkApp at ${zkAppAddress}`);
      } catch (error) {
        console.warn(`Invalid zkApp address: ${zkAppAddress}`);
      }
    }
  }

  /**
   * Setup the Mina network connection
   */
  private setupNetwork(): void {
    if (this.network === 'testnet') {
      const Berkeley = Mina.Network(
        'https://api.minascan.io/node/devnet/v1/graphql'
      );
      Mina.setActiveInstance(Berkeley);
      console.log('Connected to Mina testnet for interactions');
    } else if (this.network === 'mainnet') {
      const Mainnet = Mina.Network(
        'https://api.minascan.io/node/mainnet/v1/graphql'
      );
      Mina.setActiveInstance(Mainnet);
      console.log('Connected to Mina mainnet for interactions');
    } else {
      // Local blockchain for development
      console.log('Using local Mina blockchain for interactions');
      // Note: Local blockchain should be initialized in main app
    }
  }

  /**
   * Get the token account state for a given token owner
   * This retrieves the on-chain state storing the authenticity proof
   */
  async getTokenAccountState(
    tokenOwnerAddress: string
  ): Promise<{
    commitment?: Field;
    creatorX?: Field;
    creatorIsOdd?: Field;
    exists: boolean;
  }> {
    if (!this.zkApp) {
      throw new Error('zkApp not initialized');
    }

    try {
      const tokenOwner = PublicKey.fromBase58(tokenOwnerAddress);
      const tokenId = this.zkApp.deriveTokenId();
      
      // Get the token account
      const account = Mina.getAccount(tokenOwner, tokenId);
      
      if (!account.zkapp) {
        return { exists: false };
      }

      // Extract state fields
      // State layout:
      // [0] = Poseidon hash of SHA256 commitment
      // [1] = Creator public key X coordinate
      // [2] = Creator public key isOdd flag
      return {
        commitment: account.zkapp.appState[0],
        creatorX: account.zkapp.appState[1],
        creatorIsOdd: account.zkapp.appState[2],
        exists: true,
      };
    } catch (error: any) {
      console.error('Error getting token account state:', error);
      // Account doesn't exist or network error
      return { exists: false };
    }
  }

  /**
   * Reconstruct the creator's public key from on-chain state
   */
  reconstructCreatorPublicKey(
    creatorX: Field,
    creatorIsOdd: Field
  ): PublicKey {
    return PublicKey.from({
      x: creatorX,
      isOdd: creatorIsOdd.equals(Field(1)).toBoolean()
    });
  }

  /**
   * Verify that an image commitment matches the on-chain state
   */
  async verifyImageCommitment(
    tokenOwnerAddress: string,
    expectedCommitment: Field
  ): Promise<{
    verified: boolean;
    creatorPublicKey?: string;
    error?: string;
  }> {
    try {
      const state = await this.getTokenAccountState(tokenOwnerAddress);
      
      if (!state.exists) {
        return {
          verified: false,
          error: 'Token account does not exist'
        };
      }

      if (!state.commitment || !state.creatorX || !state.creatorIsOdd) {
        return {
          verified: false,
          error: 'Invalid token account state'
        };
      }

      // Check if commitment matches
      const commitmentsMatch = state.commitment.equals(expectedCommitment).toBoolean();
      
      if (!commitmentsMatch) {
        return {
          verified: false,
          error: 'Commitment does not match on-chain state'
        };
      }

      // Reconstruct creator public key
      const creatorPublicKey = this.reconstructCreatorPublicKey(
        state.creatorX,
        state.creatorIsOdd
      );

      return {
        verified: true,
        creatorPublicKey: creatorPublicKey.toBase58()
      };
    } catch (error: any) {
      return {
        verified: false,
        error: error.message
      };
    }
  }

  /**
   * Get the zkApp account state (for monitoring)
   */
  async getZkAppState(): Promise<{
    exists: boolean;
    balance?: string;
    nonce?: string;
  }> {
    if (!this.zkAppAddress) {
      return { exists: false };
    }

    try {
      const zkAppPublicKey = PublicKey.fromBase58(this.zkAppAddress);
      const account = Mina.getAccount(zkAppPublicKey);
      
      return {
        exists: true,
        balance: account.balance.toString(),
        nonce: account.nonce.toString(),
      };
    } catch (error) {
      return { exists: false };
    }
  }

  /**
   * Get the token ID for this zkApp
   */
  getTokenId(): Field | null {
    if (!this.zkApp) {
      return null;
    }
    return this.zkApp.deriveTokenId();
  }

  /**
   * Switch to a different network
   */
  switchNetwork(network: string): void {
    this.network = network;
    this.setupNetwork();
  }
}