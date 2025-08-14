import { Request, Response } from 'express';
import { HashingService } from '../services/image/hashing.service';
import { VerificationService } from '../services/image/verification.service';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository';
import { ProofGenerationService } from '../services/zk/proofGeneration.service';
import { ProofPublishingService } from '../services/zk/proofPublishing.service';
import { UploadResponse, ErrorResponse, ProofGenerationTask } from '../types';
import fs from 'fs';

export class UploadHandler {
  constructor(
    private hashingService: HashingService,
    private verificationService: VerificationService,
    private repository: AuthenticityRepository,
    private proofGenerationService: ProofGenerationService,
    private proofPublishingService: ProofPublishingService
  ) {}

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

      // Validate required fields
      if (!file) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No image file provided',
            field: 'image',
          },
        });
        return;
      }

      if (!publicKey) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Public key is required',
            field: 'publicKey',
          },
        });
        return;
      }

      if (!signature) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Signature is required',
            field: 'signature',
          },
        });
        return;
      }

      // Read image buffer
      const imageBuffer = fs.readFileSync(file.path);

      // Validate inputs
      const validation = this.verificationService.validateInputs(publicKey, signature, imageBuffer);

      if (!validation.valid) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.error || 'Invalid input',
          },
        });
        // Clean up uploaded file
        fs.unlinkSync(file.path);
        return;
      }

      // Compute SHA256 hash of image
      const sha256Hash = this.hashingService.computeSHA256(imageBuffer);
      console.log(`Image SHA256: ${sha256Hash}`);

      // Check for existing record (duplicate detection)
      const existing = await this.repository.checkExistingImage(sha256Hash);
      if (existing.exists) {
        console.log(`Duplicate image detected: ${sha256Hash}`);

        // Clean up uploaded file
        fs.unlinkSync(file.path);

        res.json({
          tokenOwnerAddress: existing.tokenOwnerAddress!,
          status: 'duplicate',
        });
        return;
      }

      // Prepare image verification (extract SHA256 state)
      console.log('Preparing image verification...');
      const verificationInputs = this.verificationService.prepareForVerification(file.path);

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
        fs.unlinkSync(file.path);
        return;
      }

      // Generate random token owner address
      const tokenOwner = this.verificationService.generateTokenOwnerAddress();
      const tokenOwnerAddress = tokenOwner.publicKey;
      const tokenOwnerPrivate = tokenOwner.privateKey;
      console.log(`Generated token owner address: ${tokenOwnerAddress}`);

      // Insert pending record in database
      await this.repository.insertPendingRecord({
        sha256Hash,
        tokenOwnerAddress,
        tokenOwnerPrivate,
        creatorPublicKey: publicKey,
        signature,
      });

      // Start proof generation and publishing asynchronously
      // We don't await this - it runs in the background
      this.generateAndPublishProof({
        sha256Hash,
        tokenOwnerAddress,
        tokenOwnerPrivateKey: tokenOwnerPrivate,
        publicKey,
        signature,
        verificationInputs,
        imagePath: file.path,
      }).catch((error) => {
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
  private async generateAndPublishProof(task: ProofGenerationTask): Promise<void> {
    try {
      console.log(`Starting proof generation for ${task.sha256Hash}`);

      // Generate the proof
      const { proof, publicInputs, creatorPrivateKey } = await this.proofGenerationService.generateProof(task);

      // Store proof data temporarily
      await this.repository.updateRecordStatus(task.sha256Hash, {
        status: 'verified',
        proofData: {
          proof: JSON.stringify(proof),
          publicInputs: JSON.stringify(publicInputs),
        },
      });

      console.log(`Proof generated successfully for ${task.sha256Hash}, now publishing...`);

      // Check if zkApp is deployed
      const isDeployed = await this.proofPublishingService.isDeployed();
      if (!isDeployed) {
        throw new Error('AuthenticityZkApp is not deployed. Please deploy the contract first.');
      }

      // Publish the proof to blockchain
      const transactionId = await this.proofPublishingService.publishProof({
        sha256Hash: task.sha256Hash,
        proof,
        publicInputs,
        tokenOwnerAddress: task.tokenOwnerAddress,
        tokenOwnerPrivateKey: task.tokenOwnerPrivateKey,
        creatorPublicKey: task.publicKey,
        creatorPrivateKey,
      });

      // Update record with transaction ID
      await this.repository.updateRecordStatus(task.sha256Hash, {
        status: 'verified',
        transactionId,
      });

      console.log(`Proof published successfully for ${task.sha256Hash}, tx: ${transactionId}`);
    } catch (error: any) {
      console.error(`Failed to generate/publish proof for ${task.sha256Hash}:`, error);

      // Delete the failed record to allow retry with same image
      const deleted = await this.repository.deleteRecord(task.sha256Hash);
      if (deleted) {
        console.log(`Deleted failed record for ${task.sha256Hash} to allow retry`);
      } else {
        console.warn(`Could not delete record for ${task.sha256Hash} - may already be deleted`);
      }
    }
  }
}
