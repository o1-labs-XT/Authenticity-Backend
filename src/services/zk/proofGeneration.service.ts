import {
  AuthenticityProgram,
  AuthenticityInputs,
  AuthenticityProof,
  FinalRoundInputs,
  Secp256r1,
  Ecdsa,
  Bytes32,
  AuthenticityZkApp,
} from 'authenticity-zkapp';
import { Cache, Mina, PublicKey, PrivateKey, AccountUpdate, fetchAccount, UInt8 } from 'o1js';
import { VerificationInputs, ECDSASignatureData } from '../image/verification.service.js';
import { logger } from '../../utils/logger.js';
import { PerformanceTracker } from '../../utils/performance.js';
import { Errors } from '../../utils/errors.js';
import { config } from '../../config/index.js';

export class ProofGenerationService {
  constructor() {
    logger.debug('ProofGenerationService initialized');
    this.setupNetwork();
  }

  private setupNetwork(): void {
    // Setup Mina network connection
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
        network: config.minaNetwork,
        endpoint: config.minaNodeEndpoint,
      },
      'Connected to Mina network'
    );
  }

  /**
   * Generate a proof of authenticity for an image
   * This matches the proof generation from the example backend
   */
  async generateProof(
    sha256Hash: string,
    signatureData: ECDSASignatureData,
    commitment: Bytes32,
    verificationInputs: VerificationInputs,
    _imagePath?: string
  ): Promise<{
    proof: AuthenticityProof;
    publicInputs: AuthenticityInputs;
  }> {
    logger.debug({ sha256Hash }, 'Generating proof for image');

    // Use cached compilation if available
    const cache = Cache.FileSystem(config.circuitCachePath);
    const compileTracker = new PerformanceTracker('proof.compile');
    await AuthenticityProgram.compile({ cache });
    compileTracker.end('success');

    // Create ECDSA signature and public key from the signature data
    const signature = new Ecdsa({
      r: BigInt('0x' + signatureData.signatureR),
      s: BigInt('0x' + signatureData.signatureS),
    });

    const publicKey = new Secp256r1({
      x: BigInt('0x' + signatureData.publicKeyX),
      y: BigInt('0x' + signatureData.publicKeyY),
    });

    // Create public inputs for the proof
    const publicInputs = new AuthenticityInputs({
      commitment: commitment, // SHA256 of the image as Bytes32
      signature: signature,
      publicKey: publicKey,
    });

    // Create private inputs (SHA256 state from round 62)
    const privateInputs = new FinalRoundInputs({
      // SHA-256 state after round 62 (second-to-last round)
      state: verificationInputs.penultimateState,
      // Initial SHA-256 state (H0-H7 constants)
      initialState: verificationInputs.initialState,
      // Message word (W_t) for the final round
      messageWord: verificationInputs.messageWord,
      // Round constant (K_t) for the final round
      roundConstant: verificationInputs.roundConstant,
    });

    logger.debug('Generating authenticity proof...');

    // Generate proof that:
    // 1. The penultimate SHA256 state correctly produces the signed hash after the final round
    // 2. The supplied signature was made with the supplied public key on the SHA256 commitment
    const proofTracker = new PerformanceTracker('proof.generate', { sha256Hash });
    const { proof } = await AuthenticityProgram.verifyAuthenticity(publicInputs, privateInputs);
    proofTracker.end('success');

    return { proof, publicInputs };
  }

  /**
   * Generate proof and create/prove transaction for publishing
   * This combines proof generation with transaction creation and proving
   */
  async generateProofAndTransaction(
    sha256Hash: string,
    signatureData: ECDSASignatureData,
    commitment: Bytes32,
    verificationInputs: VerificationInputs,
    zkAppAddress: string,
    imagePath?: string
  ): Promise<{
    proof: AuthenticityProof;
    transactionJson: string; // Serialized Mina transaction for later signing/sending
    tokenOwnerAddress: string;
    tokenOwnerPrivateKey: string;
  }> {
    logger.debug({ sha256Hash, zkAppAddress }, 'Generating proof and transaction');

    // Check if zkApp is deployed
    const isDeployed = await this.isDeployed(zkAppAddress);
    if (!isDeployed) {
      throw Errors.internal(`AuthenticityZkApp at ${zkAppAddress} is not deployed`);
    }

    // Step 1: Generate the authenticity proof
    const { proof } = await this.generateProof(
      sha256Hash,
      signatureData,
      commitment,
      verificationInputs,
      imagePath
    );

    // Step 2: Generate token owner key (will be used later during publishing)
    const tokenOwnerPrivate = PrivateKey.random();
    const tokenOwner = tokenOwnerPrivate.toPublicKey();

    // Step 3: Create and prove zkApp transaction
    logger.info('Creating and proving zkApp transaction');

    // Create zkApp instance for this specific address
    const zkAppPublicKey = PublicKey.fromBase58(zkAppAddress);
    const zkApp = new AuthenticityZkApp(zkAppPublicKey);

    // Compile zkApp contracts
    const cache = Cache.FileSystem(config.circuitCachePath);
    const compileTracker = new PerformanceTracker('publish.compile');
    await AuthenticityZkApp.compile({ cache });
    compileTracker.end('success');

    // Create fee payer key for transaction structure
    if (!config.feePayerPrivateKey) {
      throw Errors.internal('Fee payer private key not configured');
    }
    const feePayer = PrivateKey.fromBase58(config.feePayerPrivateKey);

    logger.debug(
      {
        feePayer: feePayer.toPublicKey().toBase58(),
        tokenOwner: tokenOwner.toBase58(),
        creator: `(${proof.publicInput.publicKey.x.toBigInt()}, ${proof.publicInput.publicKey.y.toBigInt()})`,
      },
      'Transaction participants'
    );

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

      // Serialize transaction to JSON (without signatures)
      const transactionJson = JSON.stringify(txn.toJSON());

      logger.info('Transaction created and proved, ready for signing/sending');

      return {
        proof,
        transactionJson,
        tokenOwnerAddress: tokenOwner.toBase58(),
        tokenOwnerPrivateKey: tokenOwnerPrivate.toBase58(),
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create and prove transaction');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw Errors.internal(`Failed to create and prove transaction: ${errorMessage}`);
    }
  }

  /**
   * Check if a specific zkApp is deployed
   */
  private async isDeployed(zkAppAddress: string): Promise<boolean> {
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
