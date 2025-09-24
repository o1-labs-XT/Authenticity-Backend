import { Request, Response, NextFunction, Express } from 'express';
import type {} from 'multer';
import { Signature, PublicKey, PrivateKey } from 'o1js';
import { ImageAuthenticityService } from '../services/image/verification.service.js';
import { AuthenticityRepository } from '../db/repositories/authenticity.repository.js';
import { JobQueueService } from '../services/queue/jobQueue.service.js';
import { MinioStorageService } from '../services/storage/minio.service.js';
import { logger } from '../utils/logger.js';
import { ErrorResponse } from '../api/middleware/error.middleware.js';
import { Errors } from '../utils/errors.js';
import fs from 'fs';

/**
 * API response for upload endpoint
 */
export interface UploadResponse {
  tokenOwnerAddress: string;
  sha256Hash?: string;
  status: 'pending' | 'duplicate';
}

export class UploadHandler {
  constructor(
    private verificationService: ImageAuthenticityService,
    private repository: AuthenticityRepository,
    private jobQueue: JobQueueService,
    private storageService: MinioStorageService
  ) {}

  /**
   * Validate upload request data
   */
  private validateUploadRequest(
    file: Express.Multer.File | undefined,
    publicKey: string | undefined,
    signature: string | undefined
  ): Buffer {
    // Validate required fields
    if (!file) {
      throw Errors.badRequest('No image file provided', 'image');
    }

    if (!publicKey) {
      throw Errors.badRequest('Public key is required', 'publicKey');
    }

    if (!signature) {
      throw Errors.badRequest('Signature is required', 'signature');
    }

    // Read image buffer
    const imageBuffer = fs.readFileSync(file.path);

    // Validate image buffer
    if (!imageBuffer || imageBuffer.length === 0) {
      throw Errors.badRequest('Image buffer is empty', 'image');
    }

    // Validate public key format
    try {
      PublicKey.fromBase58(publicKey);
    } catch {
      throw Errors.badRequest('Invalid public key format', 'publicKey');
    }

    // Validate signature format
    try {
      Signature.fromBase58(signature);
    } catch {
      throw Errors.badRequest('Invalid signature format', 'signature');
    }

    return imageBuffer;
  }

  /**
   * Handle image upload request
   * This is the main endpoint for provers to upload images
   */
  async handleUpload(
    req: Request,
    res: Response<UploadResponse | ErrorResponse>,
    next: NextFunction
  ): Promise<void> {
    try {
      logger.debug('Processing upload request');

      // Extract from multipart form data
      const file = req.file;
      const { publicKey, signature } = req.body;

      // Validate request and get image buffer
      const imageBuffer = this.validateUploadRequest(file, publicKey, signature);

      // Compute SHA256 hash of image
      const sha256Hash = this.verificationService.hashImage(imageBuffer);
      logger.debug({ sha256Hash }, 'Image hash calculated');

      // Check for existing record (duplicate detection)
      const existing = await this.repository.checkExistingImage(sha256Hash);
      if (existing.exists) {
        logger.info('Duplicate image detected');

        // Clean up uploaded file
        fs.unlinkSync(file!.path);

        res.json({
          tokenOwnerAddress: existing.tokenOwnerAddress!,
          status: 'duplicate',
        });
        return;
      }

      // Verify signature and prepare image for proof generation
      logger.debug('Verifying signature');
      const verificationResult = this.verificationService.verifyAndPrepareImage(
        file!.path,
        signature,
        publicKey
      );

      if (!verificationResult.isValid) {
        logger.warn({ error: verificationResult.error }, 'Invalid signature');
        // Clean up uploaded file
        fs.unlinkSync(file!.path);
        throw Errors.badRequest(
          verificationResult.error || 'Signature verification failed',
          'signature'
        );
      }

      // Generate random token owner address
      const tokenOwnerKey = PrivateKey.random();
      const tokenOwnerAddress = tokenOwnerKey.toPublicKey().toBase58();
      const tokenOwnerPrivate = tokenOwnerKey.toBase58();
      logger.debug({ tokenOwnerAddress }, 'Generated token owner');

      // Insert pending record in database first
      await this.repository.insertPendingRecord({
        sha256Hash,
        tokenOwnerAddress,
        tokenOwnerPrivate,
        creatorPublicKey: publicKey,
        signature,
      });

      // Upload image to MinIO
      let storageKey: string;
      try {
        storageKey = await this.storageService.uploadImage(sha256Hash, imageBuffer);
        logger.debug({ storageKey, sha256Hash }, 'Image uploaded to MinIO');
      } catch (error) {
        logger.error({ err: error }, 'Failed to upload image to MinIO');
        // Clean up the database record
        await this.repository.deleteRecord(sha256Hash);
        // Clean up temp file
        fs.unlinkSync(file!.path);
        throw error;
      }

      // Clean up temp file after successful MinIO upload
      fs.unlinkSync(file!.path);

      // Enqueue job for proof generation
      try {
        const jobId = await this.jobQueue.enqueueProofGeneration({
          sha256Hash,
          signature,
          publicKey,
          storageKey,
          tokenOwnerAddress,
          tokenOwnerPrivateKey: tokenOwnerPrivate,
          uploadedAt: new Date(),
          // logging correlation id
          correlationId: (req as Request & { correlationId: string }).correlationId,
        });

        // Update record with job ID for tracking
        await this.repository.updateRecord(sha256Hash, { job_id: jobId });

        logger.info({ jobId }, 'Proof generation job enqueued');
      } catch (error) {
        logger.error({ err: error }, 'Failed to enqueue job');
        // Clean up the record if job enqueue fails
        await this.repository.deleteRecord(sha256Hash);
        // Try to clean up MinIO image
        try {
          await this.storageService.deleteImage(storageKey);
        } catch (deleteError) {
          logger.warn({ err: deleteError }, 'Failed to delete MinIO image after job failure');
        }
        throw error;
      }

      // Return token owner address immediately
      res.json({
        tokenOwnerAddress,
        sha256Hash,
        status: 'pending',
      });
    } catch (error) {
      logger.error({ err: error }, 'Upload handler error');

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

      // Pass error to middleware
      next(error);
    }
  }
}
