import { Request, Response } from 'express';
import type { } from 'multer';
import { Signature, PublicKey, PrivateKey } from 'o1js';
import { ImageAuthenticityService } from '../services/image/verification.service.js';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { JobQueueService } from '../services/queue/jobQueue.service.js';
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
    private verificationService: ImageAuthenticityService,
    private repository: AuthenticityRepository,
    private jobQueue: JobQueueService
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
      PublicKey.fromBase58(publicKey);
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
      Signature.fromBase58(signature);
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
      const sha256Hash = this.verificationService.hashImage(imageBuffer);
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

      // Verify signature and prepare image for proof generation
      console.log('Verifying signature and preparing image...');
      const verificationResult = this.verificationService.verifyAndPrepareImage(
        file!.path,
        signature,
        publicKey
      );

      if (!verificationResult.isValid) {
        console.log('Invalid signature for image hash:', verificationResult.error);
        res.status(400).json({
          error: {
            code: 'INVALID_SIGNATURE',
            message: verificationResult.error || 'Signature verification failed',
          },
        });
        // Clean up uploaded file
        fs.unlinkSync(file!.path);
        return;
      }

      // Generate random token owner address
      const tokenOwnerKey = PrivateKey.random();
      const tokenOwnerAddress = tokenOwnerKey.toPublicKey().toBase58();
      const tokenOwnerPrivate = tokenOwnerKey.toBase58();
      console.log(`Generated token owner address: ${tokenOwnerAddress}`);

      // Insert pending record in database first
      await this.repository.insertPendingRecord({
        sha256Hash,
        tokenOwnerAddress,
        tokenOwnerPrivate,
        creatorPublicKey: publicKey,
        signature,
      });

      // Enqueue job for proof generation
      try {
        const jobId = await this.jobQueue.enqueueProofGeneration({
          sha256Hash,
          signature,
          publicKey,
          imagePath: file!.path,
          tokenOwnerAddress,
          tokenOwnerPrivateKey: tokenOwnerPrivate,
          uploadedAt: new Date(),
        });

        // Update record with job ID for tracking
        await this.repository.updateRecord(sha256Hash, { job_id: jobId });

        console.log(`Enqueued proof generation job ${jobId} for ${sha256Hash}`);
      } catch (error) {
        console.error(`Failed to enqueue job for ${sha256Hash}:`, error);
        // Clean up the record if job enqueue fails
        await this.repository.deleteRecord(sha256Hash);
        throw error;
      }

      // Return token owner address immediately
      res.json({
        tokenOwnerAddress,
        sha256Hash,
        status: 'pending',
      });
    } catch (error) {
      console.error('Upload error:', error);

      // Clean up uploaded file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      // Check if it's a database constraint error
      if (error instanceof Error && error.message?.includes('already exists')) {
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
