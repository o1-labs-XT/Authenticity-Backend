import { prepareImageVerification, AuthenticityInputs, FinalRoundInputs } from 'authenticity-zkapp';
import { Signature, PublicKey, Field, PrivateKey } from 'o1js';
import fs from 'fs';
import { VerificationInputs } from '../../types/index.js';

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
   * Prepare image from buffer instead of file path
   */
  prepareFromBuffer(imageBuffer: Buffer): VerificationInputs {
    // Write to temporary file since prepareImageVerification expects a path
    const tempPath = `/tmp/temp_image_${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, imageBuffer);

    try {
      const inputs = this.prepareForVerification(tempPath);
      return inputs;
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
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

  /**
   * Create AuthenticityInputs for the zkProgram
   * These are the public inputs to the proof
   */
  createAuthenticityInputs(
    commitment: Field,
    signature: Signature,
    publicKey: PublicKey
  ): AuthenticityInputs {
    return new AuthenticityInputs({
      commitment,
      signature,
      publicKey,
    });
  }

  /**
   * Create FinalRoundInputs for the zkProgram
   * These are the private inputs to the proof
   */
  createFinalRoundInputs(verificationInputs: VerificationInputs): FinalRoundInputs {
    return new FinalRoundInputs({
      state: verificationInputs.penultimateState,
      initialState: verificationInputs.initialState,
      messageWord: verificationInputs.messageWord,
      roundConstant: verificationInputs.roundConstant,
    });
  }

  /**
   * Validate that all required inputs are present and valid
   */
  validateInputs(
    publicKey: string,
    signature: string,
    imageBuffer: Buffer
  ): { valid: boolean; error?: string } {
    // Check image buffer
    if (!imageBuffer || imageBuffer.length === 0) {
      return { valid: false, error: 'Image buffer is empty' };
    }

    // Check public key format
    try {
      PublicKey.fromBase58(publicKey);
    } catch {
      return { valid: false, error: 'Invalid public key format' };
    }

    // Check signature format
    try {
      Signature.fromBase58(signature);
    } catch {
      return { valid: false, error: 'Invalid signature format' };
    }

    return { valid: true };
  }
}
