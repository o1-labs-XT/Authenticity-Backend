import { Field, Poseidon } from 'o1js';
import { hashImageOffCircuit, computeOnChainCommitment } from 'authenticity-zkapp';

export class HashingService {
  /**
   * Compute SHA256 hash of image buffer using authenticity-zkapp
   * This matches the implementation in the example backend
   */
  computeSHA256(imageBuffer: Buffer): string {
    // Use the hashImageOffCircuit function from authenticity-zkapp
    // This ensures consistency with the zkApp's expected format
    return hashImageOffCircuit(imageBuffer);
  }

  /**
   * Convert SHA256 hex string to Field for zkApp
   * The SHA256 hash needs to be converted to a Field element for use in the circuit
   */
  sha256ToField(sha256Hash: string): Field {
    // Convert hex string to BigInt then to Field
    // Remove '0x' prefix if present
    const cleanHash = sha256Hash.startsWith('0x') ? sha256Hash.slice(2) : sha256Hash;
    const hashBigInt = BigInt('0x' + cleanHash);
    return Field(hashBigInt);
  }

  /**
   * Compute Poseidon hash of SHA256 commitment for on-chain storage
   * This is what gets stored in the token account state
   */
  computePoseidonHash(sha256Field: Field): Field {
    // Use Poseidon hash for on-chain storage
    // This matches what the zkApp expects
    return Poseidon.hash([sha256Field]);
  }

  /**
   * Helper function that computes the on-chain commitment directly from image data
   * This combines SHA256 hashing and Poseidon hashing
   */
  async computeOnChainCommitment(imageBuffer: Buffer): Promise<Field> {
    // Use the helper from authenticity-zkapp that combines both operations
    return computeOnChainCommitment(imageBuffer).poseidon;
  }

  /**
   * Verify that a given SHA256 hash matches the image buffer
   */
  verifyImageHash(imageBuffer: Buffer, expectedHash: string): boolean {
    const computedHash = this.computeSHA256(imageBuffer);
    return computedHash === expectedHash;
  }

  /**
   * Convert Field back to hex string for storage/display
   */
  fieldToHex(field: Field): string {
    return field.toBigInt().toString(16);
  }
}
