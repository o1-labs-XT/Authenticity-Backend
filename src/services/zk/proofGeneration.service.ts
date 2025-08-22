import {
  AuthenticityProgram,
  AuthenticityInputs,
  AuthenticityProof,
  FinalRoundInputs
} from 'authenticity-zkapp'; 
import fs from 'fs';
import { PublicKey, Signature, Cache } from 'o1js';
import { VerificationInputs } from '../image/verification.service.js';

export class ProofGenerationService {

  constructor() {
    console.log('ProofGenerationService initialized');
  }


  /**
   * Generate a proof of authenticity for an image
   * This matches the proof generation from the example backend
   */
  async generateProof(
    sha256Hash: string,
    publicKey: string,
    signature: string,
    verificationInputs: VerificationInputs,
    imagePath?: string
  ): Promise<{
    proof: AuthenticityProof;
    publicInputs: AuthenticityInputs;
  }> {
    console.log(`Generating proof for SHA256: ${sha256Hash}`);
    
    // Use cached compilation if available
    const cacheDir = process.env.CIRCUIT_CACHE_PATH || './cache';
    const cache = Cache.FileSystem(cacheDir);
    await AuthenticityProgram.compile({ cache });

    const pubKey = PublicKey.fromBase58(publicKey);
    const sig = Signature.fromBase58(signature);

    // Create public inputs for the proof
    const publicInputs = new AuthenticityInputs({
      commitment: verificationInputs.expectedHash, // SHA256 of the image
      signature: sig,
      publicKey: pubKey,
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

    console.log('Generating authenticity proof...'); 
    
    // Generate proof that:
    // 1. The penultimate SHA256 state correctly produces the signed hash after the final round
    // 2. The supplied signature was made with the supplied public key on the SHA256 commitment
    const { proof } = await AuthenticityProgram.verifyAuthenticity(
      publicInputs,
      privateInputs
    );
 

    return { proof, publicInputs };
  }

}
