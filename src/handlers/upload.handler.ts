import { Request, Response } from 'express';
import { hashImageOffCircuit } from 'authenticity-zkapp';
import { VerificationService, VerificationInputs } from '../services/image/verification.service.js';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { ProofGenerationService } from '../services/zk/proofGeneration.service.js';
import { ProofPublishingService } from '../services/zk/proofPublishing.service.js';
import { ErrorResponse } from '../api/middleware/error.middleware.js';
import fs from 'fs';

/**
 * API response for upload endpoint
 */
export interface UploadResponse {
  tokenOwnerAddress: string;
  sha256Hash?: string;
  status: 'pending' | 'duplicate';
}

interface ValidationResult {
  isValid: boolean;
  error?: {
    code: string;
    message: string;
    field?: string;
  };
  imageBuffer?: Buffer;
}

export class UploadHandler {
  constructor(
    private verificationService: VerificationService,
    private repository: AuthenticityRepository,
    private proofGenerationService: ProofGenerationService,
    private proofPublishingService: ProofPublishingService
  ) {}

  /**
   * Validate upload request data
   */
  private validateUploadRequest(
    file: Express.Multer.File | undefined,
    publicKey: string | undefined,
    signature: string | undefined
  ): ValidationResult {
    // Validate required fields
    if (!file) {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No image file provided',
          field: 'image',
        },
      };
    }

    if (!publicKey) {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Public key is required',
          field: 'publicKey',
        },
      };
    }

    if (!signature) {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Signature is required',
          field: 'signature',
        },
      };
    }

    // Read image buffer
    const imageBuffer = fs.readFileSync(file.path);

    // Validate image buffer
    if (!imageBuffer || imageBuffer.length === 0) {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Image buffer is empty',
          field: 'image',
        },
      };
    }

    // Validate public key format
    try {
      this.verificationService.parsePublicKey(publicKey);
    } catch {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid public key format',
          field: 'publicKey',
        },
      };
    }

    // Validate signature format
    try {
      this.verificationService.parseSignature(signature);
    } catch {
      return {
        isValid: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid signature format',
          field: 'signature',
        },
      };
    }

    return {
      isValid: true,
      imageBuffer,
    };
  }

  /**
   * Handle image upload request
   * This is the main endpoint for provers to upload images
   */
  async handleUpload(req: Request, res: Response<UploadResponse | ErrorResponse>): Promise<void> {
    try {
      console.log('Processing upload request');

      // Extract from multipart form data
      const file = req.file;
      const { publicKey, signature } = req.body;

      // Validate request
      const validation = this.validateUploadRequest(file, publicKey, signature);
      if (!validation.isValid) {
        res.status(400).json({ error: validation.error! });
        if (file) {
          fs.unlinkSync(file.path);
        }
        return;
      }

      const imageBuffer = validation.imageBuffer!;

      // Compute SHA256 hash of image
      const sha256Hash = hashImageOffCircuit(imageBuffer);
      console.log(`Image SHA256: ${sha256Hash}`);

      // Check for existing record (duplicate detection)
      const existing = await this.repository.checkExistingImage(sha256Hash);
      if (existing.exists) {
        console.log(`Duplicate image detected: ${sha256Hash}`);

        // Clean up uploaded file
        fs.unlinkSync(file!.path);

        res.json({
          tokenOwnerAddress: existing.tokenOwnerAddress!,
          status: 'duplicate',
        });
        return;
      }

      // Prepare image verification (extract SHA256 state)
      console.log('Preparing image verification...');
      const verificationInputs = this.verificationService.prepareForVerification(file!.path);

      // Parse signature and public key
      const sig = this.verificationService.parseSignature(signature);
      const pubKey = this.verificationService.parsePublicKey(publicKey);

      // Verify signature matches expected hash (outside circuit for performance)
      const isValid = this.verificationService.verifySignature(
        sig,
        verificationInputs.expectedHash,
        pubKey
      );

      if (!isValid) {
        console.log('Invalid signature for image hash');
        res.status(400).json({
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Signature does not match image hash',
          },
        });
        // Clean up uploaded file
        fs.unlinkSync(file!.path);
        return;
      }

      // Generate random token owner address
      const tokenOwner = this.verificationService.generateTokenOwnerAddress();
      const tokenOwnerAddress = tokenOwner.publicKey;
      const tokenOwnerPrivate = tokenOwner.privateKey;
      console.log(`Generated token owner address: ${tokenOwnerAddress}`);

      // Start proof generation and publishing asynchronously
      // We don't await this - it runs in the background
      this.generateAndPublishProof(
        sha256Hash,
        tokenOwnerAddress,
        tokenOwnerPrivate,
        publicKey,
        signature,
        verificationInputs,
        file!.path
      ).catch((error) => {
        console.error(`Failed to generate/publish proof for ${sha256Hash}:`, error);
      });

      // Return token owner address immediately
      res.json({
        tokenOwnerAddress,
        sha256Hash,
        status: 'pending',
      });
    } catch (error: any) {
      console.error('Upload error:', error);

      // Clean up uploaded file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      // Check if it's a database constraint error
      if (error.message?.includes('already exists')) {
        // This shouldn't happen as we check for duplicates, but handle it anyway
        const sha256Hash = error.message.match(/hash ([\w\d]+)/)?.[1];
        if (sha256Hash) {
          const existing = await this.repository.getRecordByHash(sha256Hash);
          if (existing) {
            res.json({
              tokenOwnerAddress: existing.token_owner_address,
              status: 'duplicate',
            });
            return;
          }
        }
      }

      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process upload',
        },
      });
    }
  }

  /**
   * Generate and publish proof (runs asynchronously in background)
   */
  private async generateAndPublishProof(
    sha256Hash: string,
    tokenOwnerAddress: string,
    tokenOwnerPrivateKey: string,
    publicKey: string,
    signature: string,
    verificationInputs: VerificationInputs,
    imagePath?: string
  ): Promise<void> {
    try {
      console.log(`Starting proof generation for ${sha256Hash}`);

      // Insert pending record in database
      await this.repository.insertPendingRecord({
        sha256Hash,
        tokenOwnerAddress,
        tokenOwnerPrivate: tokenOwnerPrivateKey,
        creatorPublicKey: publicKey,
        signature,
      });

      // Generate the proof
      const { proof, publicInputs } = await this.proofGenerationService.generateProof(
        sha256Hash,
        publicKey,
        signature,
        verificationInputs,
        imagePath
      );

      // Store proof data temporarily
      // todo: do we have any reason to store the proof? could be useful when implementing retry logic
      await this.repository.updateRecordStatus(sha256Hash, {
        status: 'pending',
        proofData: {
          proof: JSON.stringify(proof),
          publicInputs: JSON.stringify(publicInputs),
        },
      });

      console.log(`Proof generated successfully for ${sha256Hash}, now publishing...`);

      // Publish the proof to blockchain
      // waits for the transaction to be published on chain
      const transactionId = await this.proofPublishingService.publishProof(
        sha256Hash,
        proof,
        publicInputs,
        tokenOwnerPrivateKey
      );

      // Update record with transaction ID
      await this.repository.updateRecordStatus(sha256Hash, {
        status: 'verified',
        transactionId,
      });

      console.log(`Proof published successfully for ${sha256Hash}, tx: ${transactionId}`);
    } catch (error: any) {
      console.error(`Failed to generate/publish proof for ${sha256Hash}:`, error);

      // Delete the failed record to allow retry with same image
      const deleted = await this.repository.deleteRecord(sha256Hash);
      if (deleted) {
        console.log(`Deleted failed record for ${sha256Hash} to allow retry`);
      } else {
        console.warn(`Could not delete record for ${sha256Hash} - may already be deleted`);
      }
    }
  }
}
