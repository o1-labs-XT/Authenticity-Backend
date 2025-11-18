import {
  AuthenticityProgram,
  AuthenticityInputs,
  AuthenticityProof,
  FinalRoundInputs,
  Secp256r1,
  Ecdsa,
  Bytes32,
} from 'authenticity-zkapp';
import { Cache } from 'o1js';
import { VerificationInputs, ECDSASignatureData } from '../image/verification.service.js';
import { logger } from '../../utils/logger.js';
import { PerformanceTracker } from '../../utils/performance.js';
import { config } from '../../config/index.js';

export class ProofGenerationService {
  constructor() {
    logger.debug('ProofGenerationService initialized');
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
}
