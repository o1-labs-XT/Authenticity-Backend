import { prepareImageVerification } from 'authenticity-zkapp';
import { Signature, PublicKey, Field, PrivateKey, UInt32 } from 'o1js';

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

export class VerificationService {
  /**
   * Prepare image for verification by extracting SHA256 state
   * This matches the prepareImageVerification from the example
   */
  prepareForVerification(imagePath: string): VerificationInputs {
    // Use the prepareImageVerification function from authenticity-zkapp
    // This extracts the penultimate SHA256 state needed for the ZK proof
    const inputs = prepareImageVerification(imagePath);

    return {
      expectedHash: inputs.expectedHash,
      penultimateState: inputs.penultimateState,
      initialState: inputs.initialState,
      messageWord: inputs.messageWord,
      roundConstant: inputs.roundConstant,
    };
  }

  /**
   * Verify signature matches the image hash
   * This is done outside the circuit for performance
   */
  verifySignature(signature: Signature, expectedHash: Field, publicKey: PublicKey): boolean {
    // Verify the signature on the expected hash
    // The signature should be on the SHA256 hash of the image
    return signature.verify(publicKey, expectedHash.toFields()).toBoolean();
  }

  /**
   * Parse signature from base58 string
   */
  parseSignature(signatureString: string): Signature {
    return Signature.fromBase58(signatureString);
  }

  /**
   * Parse public key from base58 string
   */
  parsePublicKey(publicKeyString: string): PublicKey {
    return PublicKey.fromBase58(publicKeyString);
  }

  /**
   * Generate random token owner address
   * This creates a new random keypair for token ownership
   */
  generateTokenOwnerAddress(): { privateKey: string; publicKey: string } {
    const randomKey = PrivateKey.random();
    return {
      privateKey: randomKey.toBase58(),
      publicKey: randomKey.toPublicKey().toBase58(),
    };
  }

}
