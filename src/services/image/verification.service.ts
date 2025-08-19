import { prepareImageVerification, AuthenticityInputs, FinalRoundInputs } from 'authenticity-zkapp';
import { Signature, PublicKey, Field, PrivateKey, Bytes } from 'o1js';
import Client from 'mina-signer';
import fs from 'fs';
import { VerificationInputs } from '../../types/index.js';

// Create Bytes32 class for SHA256 handling
class Bytes32 extends Bytes(32) {}

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
   * Verify Auro wallet signature using mina-signer
   * Auro signs the SHA256 hex string with Poseidon hashing
   */
  verifyAuroSignature(
    signatureJson: string,
    sha256Hex: string,
    publicKeyBase58: string
  ): boolean {
    try {
      // Create mina-signer client with testnet network
      // IMPORTANT: Auro wallet signs with 'testnet' network even when connected to devnet
      const network = 'testnet'; // Force testnet to match Auro's signing
      const client = new Client({ network: network as any });
      
      // Parse the JSON signature from Auro
      const signature = typeof signatureJson === 'string' 
        ? JSON.parse(signatureJson) 
        : signatureJson;
      
      console.log('Auro signature verification details:');
      console.log('  SHA256 hex:', sha256Hex);
      console.log('  Public key:', publicKeyBase58);
      console.log('  Signature field:', signature.field?.substring(0, 20) + '...');
      console.log('  Signature scalar:', signature.scalar?.substring(0, 20) + '...');
      console.log('  Network:', network);
      
      // Convert SHA256 to Bytes32.toFields() format
      // The frontend now sends the fields string for Auro to sign
      const bytes32 = Bytes32.fromHex(sha256Hex);
      const fields = bytes32.toFields();
      const fieldsString = fields.map(f => f.toString()).join(',');
      
      console.log('  Fields string (what Auro signed):', fieldsString.substring(0, 50) + '...');
      
      // Use mina-signer to verify (it handles the string→bits→Poseidon flow)
      const isValid = client.verifyMessage({
        data: fieldsString,      // Verify against the fields string
        signature: signature,    // Auro signature object
        publicKey: publicKeyBase58
      });

      console.log(`Auro signature verification result: ${isValid}`);
      return isValid;
    } catch (error) {
      console.error('Auro signature verification error:', error);
      return false;
    }
  }

  /**
   * Verify signature with type support (direct or Auro)
   */
  verifySignatureWithType(
    signature: string,
    sha256Hex: string,
    publicKey: string,
    signatureType: 'direct' | 'auro' = 'direct'
  ): boolean {
    if (signatureType === 'auro') {
      return this.verifyAuroSignature(signature, sha256Hex, publicKey);
    } else {
      // Existing direct signature verification
      const sig = this.parseSignature(signature);
      const pubKey = this.parsePublicKey(publicKey);
      // For direct signatures, we need to convert SHA256 to Field
      // This assumes the expectedHash is passed separately or derived
      // Note: This might need adjustment based on how expectedHash is computed
      const expectedHash = Field(sha256Hex); // This needs proper conversion
      return this.verifySignature(sig, expectedHash, pubKey);
    }
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
    imageBuffer: Buffer,
    signatureType: 'direct' | 'auro' = 'direct'
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

    // Check signature format based on type
    if (signatureType === 'auro') {
      // For Auro, signature should be a JSON string with field and scalar
      try {
        const sig = typeof signature === 'string' ? JSON.parse(signature) : signature;
        if (!sig.field || !sig.scalar) {
          return { valid: false, error: 'Invalid Auro signature format - missing field or scalar' };
        }
      } catch {
        return { valid: false, error: 'Invalid Auro signature format - not valid JSON' };
      }
    } else {
      // For direct signatures, check base58 format
      try {
        Signature.fromBase58(signature);
      } catch {
        return { valid: false, error: 'Invalid signature format' };
      }
    }

    return { valid: true };
  }
}
