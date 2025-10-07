import {
  AuthenticityZkApp,
  AuthenticityProof,
  AuthenticityInputs,
  BatchReducerUtils,
} from 'authenticity-zkapp';
import { Mina, PublicKey, PrivateKey, AccountUpdate, fetchAccount, UInt8 } from 'o1js';
import { AuthenticityRepository } from '../../db/repositories/authenticity.repository.js';
import { MinaNodeService } from '../blockchain/minaNode.service.js';
import { logger } from '../../utils/logger.js';
import { Errors } from '../../utils/errors.js';
import { PerformanceTracker } from '../../utils/performance.js';

export class ProofPublishingService {
  private zkApp: AuthenticityZkApp;
  private zkAppAddress: string;
  private feePayerKey: string;

  constructor(
    zkAppAddress: string,
    feePayerKey: string,
    network: string,
    private repository?: AuthenticityRepository,
    private minaNodeService?: MinaNodeService
  ) {
    this.zkAppAddress = zkAppAddress;
    this.feePayerKey = feePayerKey;

    // Initialize network
    this.setupNetwork(network);

    // Initialize zkApp instance - will throw if address is invalid
    const zkAppPublicKey = PublicKey.fromBase58(this.zkAppAddress);
    this.zkApp = new AuthenticityZkApp(zkAppPublicKey);
    logger.info(`ProofPublishingService initialized with zkApp at ${zkAppAddress}`);
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
      logger.info('Connected to Mina testnet at https://api.minascan.io/node/devnet/v1/graphql');
    } else if (network === 'mainnet') {
      const Mainnet = Mina.Network('https://api.minascan.io/node/mainnet/v1/graphql');
      Mina.setActiveInstance(Mainnet);
      logger.info('Connected to Mina mainnet');
    }
  }

  /**
   * Publish a proof of authenticity to the blockchain
   * This calls the deployed AuthenticityZkApp.verifyAndStore method
   * Automatically saves the transaction ID to the database as soon as it's available
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
      throw Errors.internal('AuthenticityZkApp is not deployed. Please deploy the contract first.');
    }

    if (!this.feePayerKey) {
      throw Errors.internal('Fee payer private key not configured');
    }

    logger.info({ sha256Hash }, 'Publishing proof to blockchain');

    // Ensure contract is compiled (o1js caches this internally)
    const compileTracker = new PerformanceTracker('publish.compile');
    BatchReducerUtils.setContractInstance(this.zkApp);
    await BatchReducerUtils.compile();
    await AuthenticityZkApp.compile();
    compileTracker.end('success');

    // Parse addresses and keys
    const tokenOwnerPrivate = PrivateKey.fromBase58(tokenOwnerPrivateKey);
    const tokenOwner = tokenOwnerPrivate.toPublicKey();
    const feePayer = PrivateKey.fromBase58(this.feePayerKey);

    logger.debug(
      {
        feePayer: feePayer.toPublicKey().toBase58(),
        tokenOwner: tokenOwner.toBase58(),
        creator: `(${proof.publicInput.publicKey.x.toBigInt()}, ${proof.publicInput.publicKey.y.toBigInt()})`,
      },
      'Transaction participants'
    );

    logger.debug('Creating transaction...');

    // Capture current block height before submitting transaction
    let submittedBlockHeight: number | undefined;
    if (this.minaNodeService) {
      try {
        submittedBlockHeight = await this.minaNodeService.getCurrentBlockHeight();
        logger.debug(
          { submittedBlockHeight },
          'Captured current block height before transaction submission'
        );
      } catch (error) {
        logger.warn(
          { err: error },
          'Failed to capture current block height, proceeding without it'
        );
      }
    }

    try {
      // Create transaction to verify and store the proof on-chain
      const txn = await Mina.transaction({ sender: feePayer.toPublicKey(), fee: 1e9 }, async () => {
        // Fund the new token account
        AccountUpdate.fundNewAccount(feePayer.toPublicKey());

        // Call verifyAndStore on the zkApp
        // Pass the actual token owner address and a default chain ID
        await this.zkApp.verifyAndStore(tokenOwner, UInt8.from(0), proof);
      });

      logger.debug('Proving transaction...');
      const proveTracker = new PerformanceTracker('publish.prove');
      await txn.prove();
      proveTracker.end('success');

      logger.debug('Signing and sending transaction...');
      // Sign with all required parties:
      // 1. Fee payer (for paying fees)
      // 2. Token owner (for the new token account)
      const signers = [feePayer, tokenOwnerPrivate];
      logger.debug(`Signing transaction with ${signers.length} signers`);
      const sendTracker = new PerformanceTracker('publish.send');
      const pendingTxn = await txn.sign(signers).send();
      sendTracker.end('success', { hash: pendingTxn.hash });

      logger.info({ transactionHash: pendingTxn.hash }, 'Transaction sent');

      // Save transaction ID and block height to database immediately after sending
      if (this.repository) {
        const updateData: { transaction_id: string; transaction_submitted_block_height?: number } =
          {
            transaction_id: pendingTxn.hash,
          };

        if (submittedBlockHeight !== undefined) {
          updateData.transaction_submitted_block_height = submittedBlockHeight;
        }

        await this.repository.updateRecord(sha256Hash, updateData);
        logger.debug(
          { sha256Hash, transactionHash: pendingTxn.hash, submittedBlockHeight },
          'Transaction ID and block height saved to database'
        );
      }

      // Wait for confirmation (optional - could be async)
      if (pendingTxn.wait) {
        logger.debug('Waiting for transaction confirmation...');
        await pendingTxn.wait();
        logger.info('Transaction confirmed on blockchain');
      }

      return pendingTxn.hash;
    } catch (error) {
      logger.error({ err: error }, 'Failed to publish proof');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw Errors.internal(`Failed to publish proof: ${errorMessage}`);
    }
  }

  /**
   * Check if the zkApp is deployed and ready
   */
  async isDeployed(): Promise<boolean> {
    try {
      const zkAppPublicKey = PublicKey.fromBase58(this.zkAppAddress);
      logger.debug(`Checking zkApp deployment at ${this.zkAppAddress}`);

      await fetchAccount({ publicKey: zkAppPublicKey });
      const account = Mina.getAccount(zkAppPublicKey);
      logger.debug(
        {
          address: zkAppPublicKey.toBase58(),
          balance: account.balance.toString(),
          nonce: account.nonce.toString(),
          hasZkapp: !!account.zkapp,
          zkappState: account.zkapp?.appState?.map((s) => s.toString()),
        },
        'Account fetched'
      );

      return !!account.zkapp;
    } catch (error) {
      logger.error({ err: error }, 'Error checking deployment');
      return false;
    }
  }
}
