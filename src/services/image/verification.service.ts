import {
  prepareImageVerification,
  hashImageOffCircuit,
  Secp256r1,
  Ecdsa,
  Bytes32,
} from 'authenticity-zkapp';
import { UInt32 } from 'o1js';

/**
 * Verification inputs from prepareImageVerification
 */
export interface VerificationInputs {
  expectedHash: Bytes32;
  penultimateState: UInt32[]; // SHA-256 state after round 62
  initialState: UInt32[]; // Initial SHA-256 state (H0-H7 constants)
  messageWord: UInt32; // Message word (W_t) for the final round
  roundConstant: UInt32; // Round constant (K_t) for the final round
}

/**
 * ECDSA signature and public key formats
 */
export interface ECDSASignatureData {
  signatureR: string; // hex string
  signatureS: string; // hex string
  publicKeyX: string; // hex string
  publicKeyY: string; // hex string
}

export class ImageAuthenticityService {
  /**
   * Compute SHA256 hash of image buffer
   */
  hashImage(imageBuffer: Buffer): string {
    return hashImageOffCircuit(imageBuffer);
  }

  /**
   * Verify ECDSA signature and prepare for proof generation
   */
  verifyAndPrepareImage(
    imagePath: string,
    signatureData: ECDSASignatureData
  ): {
    isValid: boolean;
    verificationInputs?: VerificationInputs;
    commitment?: Bytes32;
    error?: string;
  } {
    try {
      // Create ECDSA signature from hex components
      const signature = new Ecdsa({
        r: BigInt('0x' + signatureData.signatureR),
        s: BigInt('0x' + signatureData.signatureS),
      });

      // Create public key from hex coordinates
      const publicKey = new Secp256r1({
        x: BigInt('0x' + signatureData.publicKeyX),
        y: BigInt('0x' + signatureData.publicKeyY),
      });

      // Extract SHA256 state for ZK proof - this already gives us the commitment as Bytes32
      const inputs = prepareImageVerification(imagePath);
      const commitment = inputs.expectedHash; // This is already a Bytes32

      const verificationInputs: VerificationInputs = {
        expectedHash: commitment,
        penultimateState: inputs.penultimateState,
        initialState: inputs.initialState,
        messageWord: inputs.messageWord,
        roundConstant: inputs.roundConstant,
      };

      // Verify ECDSA signature against the commitment
      const isValid = signature.verifySignedHash(commitment, publicKey).toBoolean();

      // todo: should this throw? add logging
      if (!isValid) {
        return {
          isValid: false,
          error: 'ECDSA signature does not match image hash',
        };
      }

      return {
        isValid: true,
        verificationInputs,
        commitment,
      };
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'ECDSA verification failed',
      };
    }
  }

  /**
   * Parse signature data from request format
   */
  parseSignatureData(
    signatureR: string | undefined,
    signatureS: string | undefined,
    publicKeyX: string | undefined,
    publicKeyY: string | undefined
  ): ECDSASignatureData | { error: string } {
    if (!signatureR || !signatureS || !publicKeyX || !publicKeyY) {
      return { error: 'Missing required signature components' };
    }

    // Validate hex format
    const hexPattern = /^[0-9a-fA-F]+$/;
    if (
      !hexPattern.test(signatureR) ||
      !hexPattern.test(signatureS) ||
      !hexPattern.test(publicKeyX) ||
      !hexPattern.test(publicKeyY)
    ) {
      return { error: 'Invalid hex format in signature components' };
    }

    // Validate lengths (32 bytes = 64 hex chars each)
    if (
      signatureR.length !== 64 ||
      signatureS.length !== 64 ||
      publicKeyX.length !== 64 ||
      publicKeyY.length !== 64
    ) {
      return { error: 'Invalid signature component lengths' };
    }

    return {
      signatureR,
      signatureS,
      publicKeyX,
      publicKeyY,
    };
  }
}
