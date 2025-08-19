import {
  AuthenticityProgram,
  AuthenticityInputs,
  FinalRoundInputs
} from 'authenticity-zkapp'; 
import { ProofGenerationTask } from '../../types/index.js';
import fs from 'fs';
import { PublicKey, Signature } from 'o1js';

export class ProofGenerationService {

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

    const pubKey = PublicKey.fromBase58(task.publicKey);
    
    // Handle both signature types
    let sig: Signature;
    if (task.signatureType === 'auro' && typeof task.signature === 'string' && (task.signature.startsWith('{') || task.signature.includes('field'))) {
      // Auro signature (JSON format)
      console.log('Parsing Auro JSON signature for proof generation');
      const sigJson = typeof task.signature === 'string' ? JSON.parse(task.signature) : task.signature;
      sig = Signature.fromJSON({
        r: sigJson.field,
        s: sigJson.scalar
      });
    } else {
      // Direct signature (base58 format)
      sig = Signature.fromBase58(task.signature);
    }

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
