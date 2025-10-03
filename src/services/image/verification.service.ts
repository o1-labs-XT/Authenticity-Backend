import { prepareImageVerification, hashImageOffCircuit } from 'authenticity-zkapp';
import { Signature, PublicKey, Field, UInt32 } from 'o1js';

/**
 * Verification inputs from prepareImageVerification
 */
export interface VerificationInputs {
  expectedHash: Field;
  penultimateState: UInt32[]; // SHA-256 state after round 62
  initialState: UInt32[]; // Initial SHA-256 state (H0-H7 constants)
  messageWord: UInt32; // Message word (W_t) for the final round
  roundConstant: UInt32; // Round constant (K_t) for the final round
}

export class ImageAuthenticityService {
  /**
   * Compute SHA256 hash of image buffer
   */
  hashImage(imageBuffer: Buffer): string {
    return hashImageOffCircuit(imageBuffer);
  }

  /**
   * Verify image signature and prepare for proof generation
   */
  verifyAndPrepareImage(
    imagePath: string,
    signatureString: string,
    publicKeyString: string
  ): {
    isValid: boolean;
    verificationInputs?: VerificationInputs;
    error?: string;
  } {
    try {
      const signature = Signature.fromBase58(signatureString);
      const publicKey = PublicKey.fromBase58(publicKeyString);

      // Extract SHA256 state for ZK proof
      const inputs = prepareImageVerification(imagePath);
      const verificationInputs: VerificationInputs = {
        expectedHash: inputs.expectedHash,
        penultimateState: inputs.penultimateState,
        initialState: inputs.initialState,
        messageWord: inputs.messageWord,
        roundConstant: inputs.roundConstant,
      };

      // Verify signature matches hash
      const isValid = signature
        .verify(publicKey, verificationInputs.expectedHash.toFields())
        .toBoolean();

      // todo: should this throw? add logging
      if (!isValid) {
        return {
          isValid: false,
          error: 'Invalid signature for public key and image hash',
        };
      }

      return {
        isValid: true,
        verificationInputs,
      };
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }
}
