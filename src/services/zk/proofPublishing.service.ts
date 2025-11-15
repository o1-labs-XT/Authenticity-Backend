import { AuthenticityZkApp, AuthenticityProof } from 'authenticity-zkapp';
import { Mina, PublicKey, PrivateKey, AccountUpdate, fetchAccount, UInt8, Cache } from 'o1js';
import { SubmissionsRepository } from '../../db/repositories/submissions.repository.js';
import { MinaNodeService } from '../blockchain/minaNode.service.js';
import { logger } from '../../utils/logger.js';
import { Errors } from '../../utils/errors.js';
import { PerformanceTracker } from '../../utils/performance.js';
import { config } from '../../config/index.js';

export class ProofPublishingService {
  private feePayerKey: string;

  constructor(
    feePayerKey: string,
    network: string,
    private submissionsRepository?: SubmissionsRepository,
    private minaNodeService?: MinaNodeService
  ) {
    this.feePayerKey = feePayerKey;
    this.setupNetwork(network);
  }

  private setupNetwork(network: string): void {
    // if the configured network is mainnet, set the networkId to mainnet
    const Network =
      config.minaNetwork === 'mainnet'
        ? Mina.Network({
            networkId: 'mainnet', // Required for mainnet signatures to be valid
            mina: config.minaNodeEndpoint,
          })
        : Mina.Network(config.minaNodeEndpoint); // default value is 'devnet', which is correct (touchgrass calls it 'testnet', so it's simpler to not specify it here)
    Mina.setActiveInstance(Network);
    logger.info(
      {
        network,
        endpoint: config.minaNodeEndpoint,
      },
      'Connected to Mina network'
    );
  }

  /**
   * Publish a proof to a specific zkApp address
   */
  async publishProof(
    sha256Hash: string,
    proof: AuthenticityProof,
    zkAppAddress: string
  ): Promise<string> {
    // Check if zkApp is deployed
    const isDeployed = await this.isDeployed(zkAppAddress);
    if (!isDeployed) {
      throw Errors.internal(`AuthenticityZkApp at ${zkAppAddress} is not deployed`);
    }

    if (!this.feePayerKey) {
      throw Errors.internal('Fee payer private key not configured');
    }

    logger.info({ sha256Hash, zkAppAddress }, 'Publishing proof to blockchain');

    // Create zkApp instance for this specific address
    const zkAppPublicKey = PublicKey.fromBase58(zkAppAddress);
    const zkApp = new AuthenticityZkApp(zkAppPublicKey);

    // Compile contracts
    const cache = Cache.FileSystem(config.circuitCachePath);
    const compileTracker = new PerformanceTracker('publish.compile');

    await AuthenticityZkApp.compile({ cache });

    compileTracker.end('success');

    // Parse addresses and keys
    const tokenOwnerPrivate = PrivateKey.random();
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

    // Count how many images this token owner has submitted so far
    try {
      // Create transaction to verify and store the proof on-chain
      const txn = await Mina.transaction(
        { sender: feePayer.toPublicKey(), fee: config.minaTransactionFee * 1e9 },
        async () => {
          // Fund the new token account
          AccountUpdate.fundNewAccount(feePayer.toPublicKey());

          // Call verifyAndStore on the zkApp
          await zkApp.verifyAndStore(tokenOwner, UInt8.from(0), proof);
        }
      );

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
      if (this.submissionsRepository) {
        const updateData: { transaction_id: string; transaction_submitted_block_height?: number } =
          {
            transaction_id: pendingTxn.hash,
          };

        if (submittedBlockHeight !== undefined) {
          updateData.transaction_submitted_block_height = submittedBlockHeight;
        }

        await this.submissionsRepository.updateBySha256Hash(sha256Hash, updateData);

        logger.debug(
          { sha256Hash, transactionHash: pendingTxn.hash, submittedBlockHeight },
          'Transaction ID and block height saved to database'
        );
      }

      // Wait for confirmation (optional - could be async)
      // if (pendingTxn.wait) {
      //   logger.debug('Waiting for transaction confirmation...');
      //   await pendingTxn.wait();
      //   logger.info('Transaction confirmed on blockchain');
      // }

      return pendingTxn.hash;
    } catch (error) {
      logger.error({ err: error }, 'Failed to publish proof');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw Errors.internal(`Failed to publish proof: ${errorMessage}`);
    }
  }

  /**
   * Check if a specific zkApp is deployed
   */
  async isDeployed(zkAppAddress: string): Promise<boolean> {
    try {
      const zkAppPublicKey = PublicKey.fromBase58(zkAppAddress);
      logger.debug(`Checking zkApp deployment at ${zkAppAddress}`);

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
