import { Mina, PrivateKey, AccountUpdate, Cache } from 'o1js';
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
   */
  async deployContract(challengeId: string): Promise<DeploymentResult> {
    try {
      logger.info({ challengeId }, 'Starting contract deployment');
      // if the configured network is mainnet, set the networkId to mainnet
      const Network =
        config.minaNetwork === 'mainnet'
          ? Mina.Network({
              networkId: 'mainnet', // Required for mainnet signatures to be valid
              mina: config.minaNodeEndpoint,
            })
          : Mina.Network(config.minaNodeEndpoint); // default value is 'devnet', which is correct (touchgrass calls it 'testnet', so it's simpler to not specify it here)
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

      // 1. AuthenticityProgram
      logger.info('Compiling AuthenticityProgram...');
      const programStartTime = Date.now();
      const cache = Cache.FileSystem(config.circuitCachePath);
      await AuthenticityProgram.compile({ cache });
      logger.info({ durationMs: Date.now() - programStartTime }, 'AuthenticityProgram compiled');

      // 2. BatchReducerUtils
      logger.info('Compiling BatchReducerUtils...');
      const batchStartTime = Date.now();
      await BatchReducerUtils.compile();
      logger.info({ durationMs: Date.now() - batchStartTime }, 'BatchReducerUtils compiled');

      // 3. AuthenticityZkApp
      logger.info('Compiling AuthenticityZkApp...');
      const contractStartTime = Date.now();
      await AuthenticityZkApp.compile({ cache });
      logger.info({ durationMs: Date.now() - contractStartTime }, 'AuthenticityZkApp compiled');

      logger.info('Creating deployment transaction');
      const deployTxn = await Mina.transaction(
        { sender: feePayerPublicKey, fee: config.minaTransactionFee * 1e9 },
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
