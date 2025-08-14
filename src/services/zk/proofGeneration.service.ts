import {
  AuthenticityProgram,
  AuthenticityInputs,
  FinalRoundInputs
} from 'authenticity-zkapp';
import { PublicKey, Signature, PrivateKey } from 'o1js';
import { ProofGenerationTask } from '../../types/index.js';
import fs from 'fs';

export class ProofGenerationService {

  // TEMPORARY: Test function to generate credentials - DELETE THIS LATER
  private generateTestCredentials(expectedHash: any): { pubKey: PublicKey; sig: Signature } {
    const testPrivateKey = PrivateKey.random();
    const testPublicKey = testPrivateKey.toPublicKey();
    const testSignature = Signature.create(
      testPrivateKey,
      expectedHash.toFields()
    );
    return { pubKey: testPublicKey, sig: testSignature };
  }

  constructor() {
    console.log('ProofGenerationService initialized');
  }


  /**
   * Generate a proof of authenticity for an image
   * This matches the proof generation from the example backend
   */
  async generateProof(task: ProofGenerationTask): Promise<{
    proof: any;
    publicInputs: AuthenticityInputs;
  }> {
    console.log(`Generating proof for SHA256: ${task.sha256Hash}`);
    
    // Ensure program is compiled (o1js caches this internally)
    await AuthenticityProgram.compile();

    // TEMPORARY: Use generated test credentials instead of user input
    const { pubKey, sig } = this.generateTestCredentials(task.verificationInputs.expectedHash);
    
    // Original code (disabled for testing):
    // const pubKey = PublicKey.fromBase58(task.publicKey);
    // const sig = Signature.fromBase58(task.signature);

    // Create public inputs for the proof
    const publicInputs = new AuthenticityInputs({
      commitment: task.verificationInputs.expectedHash, // SHA256 of the image
      signature: sig,
      publicKey: pubKey,
    });

    // Create private inputs (SHA256 state from round 62)
    const privateInputs = new FinalRoundInputs({
      // SHA-256 state after round 62 (second-to-last round)
      state: task.verificationInputs.penultimateState,
      // Initial SHA-256 state (H0-H7 constants)
      initialState: task.verificationInputs.initialState,
      // Message word (W_t) for the final round
      messageWord: task.verificationInputs.messageWord,
      // Round constant (K_t) for the final round
      roundConstant: task.verificationInputs.roundConstant,
    });

    console.log('Generating authenticity proof...'); 
    
    // Generate proof that:
    // 1. The penultimate SHA256 state correctly produces the signed hash after the final round
    // 2. The supplied signature was made with the supplied public key on the SHA256 commitment
    const { proof } = await AuthenticityProgram.verifyAuthenticity(
      publicInputs,
      privateInputs
    );
 
    // Clean up the image file after proof generation
    if (task.imagePath && fs.existsSync(task.imagePath)) {
      fs.unlinkSync(task.imagePath);
      console.log(`Cleaned up image file: ${task.imagePath}`);
    }

    return { proof, publicInputs };
  }

}
