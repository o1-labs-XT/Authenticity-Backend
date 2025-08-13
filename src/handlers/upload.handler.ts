import { Request, Response } from 'express';
import { HashingService } from '../services/image/hashing.service';
import { VerificationService } from '../services/image/verification.service';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository';
import { ProofQueueService } from '../services/queue/proofQueue.service';
import { UploadResponse, ErrorResponse } from '../types';
import fs from 'fs';

export class UploadHandler {
  constructor(
    private hashingService: HashingService,
    private verificationService: VerificationService,
    private repository: AuthenticityRepository,
    private queueService: ProofQueueService
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
      const validation = this.verificationService.validateInputs(
        publicKey,
        signature,
        imageBuffer
      );

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
      const tokenOwnerAddress = this.verificationService.generateTokenOwnerAddress();
      console.log(`Generated token owner address: ${tokenOwnerAddress}`);

      // Insert pending record in database
      await this.repository.insertPendingRecord({
        sha256Hash,
        tokenOwnerAddress,
        creatorPublicKey: publicKey,
        signature,
      });

      // Queue proof generation task
      const taskId = await this.queueService.enqueueProofGeneration({
        sha256Hash,
        tokenOwnerAddress,
        publicKey,
        signature,
        verificationInputs,
        imagePath: file.path,
      });

      console.log(`Queued proof generation task: ${taskId}`);

      // Note: We're not cleaning up the file here as the proof generation
      // service will need it. The service should clean it up after processing.

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
}