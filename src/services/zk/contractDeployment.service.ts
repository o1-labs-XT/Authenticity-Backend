import { Mina, PrivateKey, AccountUpdate } from 'o1js';
import { AuthenticityZkApp, AuthenticityProgram, BatchReducerUtils } from 'authenticity-zkapp';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';

export interface DeploymentResult {
  success: boolean;
  zkAppAddress?: string;
  txHash?: string;
  error?: string;
}

export class ContractDeploymentService {
  constructor(private readonly feePayerPrivateKey: string) {}

  /**
   * Deploy a new AuthenticityZkApp contract
   *
   * Compilation Strategy:
   * - AuthenticityProgram and AuthenticityZkApp are pre-compiled at worker startup
   *   via compile-zkapp.ts script (loaded from cache during deployment)
   * - BatchReducerUtils is compiled per-deployment with the actual zkApp instance
   *   to ensure proper binding (follows proven pattern from proofPublishing.service.ts)
   *
   * TODO: Investigate if BatchReducerUtils can be compiled once at startup with a
   * dummy instance to speed up deployments. Current approach is safe but slower.
   */
  async deployContract(challengeId: string): Promise<DeploymentResult> {
    try {
      logger.info({ challengeId }, 'Starting contract deployment');

      // Connect to network using MINA_NODE_ENDPOINT from config
      const Network = Mina.Network(config.minaNodeEndpoint);
      Mina.setActiveInstance(Network);
      logger.info({ endpoint: config.minaNodeEndpoint }, 'Connected to Mina network');

      // Load fee payer
      const feePayerKey = PrivateKey.fromBase58(this.feePayerPrivateKey);
      const feePayerPublicKey = feePayerKey.toPublicKey();
      logger.debug({ feePayerAddress: feePayerPublicKey.toBase58() }, 'Fee payer loaded');

      // Generate random zkApp key for this challenge
      const zkAppKey = PrivateKey.random();
      const zkAppAddress = zkAppKey.toPublicKey();
      logger.info({ zkAppAddress: zkAppAddress.toBase58() }, 'Generated zkApp address');

      // Create zkApp instance and bind BatchReducer
      const zkApp = new AuthenticityZkApp(zkAppAddress);
      BatchReducerUtils.setContractInstance(zkApp);

      // IMPORTANT: Must compile in this exact order to satisfy dependencies
      // Reference: ../Authenticity-Zkapp/PGBOSS_DEPLOYMENT_SNIPPET.md (lines 260-266)

      // 1. AuthenticityProgram (the zkProgram dependency)
      logger.info('Compiling AuthenticityProgram...');
      const programStartTime = Date.now();
      await AuthenticityProgram.compile();
      logger.info({ durationMs: Date.now() - programStartTime }, 'AuthenticityProgram compiled');

      // 2. BatchReducerUtils (the batch reducer)
      logger.info('Compiling BatchReducerUtils...');
      const batchStartTime = Date.now();
      await BatchReducerUtils.compile();
      logger.info({ durationMs: Date.now() - batchStartTime }, 'BatchReducerUtils compiled');

      // 3. AuthenticityZkApp (depends on AuthenticityProgram)
      logger.info('Compiling AuthenticityZkApp...');
      const contractStartTime = Date.now();
      await AuthenticityZkApp.compile();
      logger.info({ durationMs: Date.now() - contractStartTime }, 'AuthenticityZkApp compiled');

      // Create deployment transaction
      // NOTE: Verify 0.1 MINA fee is sufficient for devnet/mainnet deployments
      // May need adjustment based on network conditions
      logger.info('Creating deployment transaction');
      const deployTxn = await Mina.transaction(
        { sender: feePayerPublicKey, fee: 0.1e9 },
        async () => {
          AccountUpdate.fundNewAccount(feePayerPublicKey);
          await zkApp.deploy();
        }
      );

      // Generate proof
      logger.info('Generating deployment proof');
      const proveStart = Date.now();
      await deployTxn.prove();
      logger.info({ durationMs: Date.now() - proveStart }, 'Deployment proof generated');

      // Sign and send
      logger.info('Signing and sending transaction');
      const signedTxn = deployTxn.sign([feePayerKey, zkAppKey]);
      const txnResult = await signedTxn.send();

      if (txnResult.status === 'pending') {
        logger.info(
          { txHash: txnResult.hash, zkAppAddress: zkAppAddress.toBase58() },
          'Contract deployment transaction sent'
        );

        return {
          success: true,
          zkAppAddress: zkAppAddress.toBase58(),
          txHash: txnResult.hash,
        };
      } else {
        throw new Error(`Transaction failed with status: ${txnResult.status}`);
      }
    } catch (error) {
      logger.error({ err: error, challengeId }, 'Contract deployment failed');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
