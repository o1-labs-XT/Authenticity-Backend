import { Request, Response, NextFunction, Express } from 'express';
import type {} from 'multer';
import { PrivateKey } from 'o1js';
import {
  ImageAuthenticityService,
  ECDSASignatureData,
} from '../services/image/verification.service.js';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
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
    private repository: SubmissionsRepository,
    private jobQueue: JobQueueService,
    private storageService: MinioStorageService
  ) {}

  /**
   * Validate upload request data for ECDSA format
   */
  private validateUploadRequest(
    file: Express.Multer.File | undefined,
    signatureR: string | undefined,
    signatureS: string | undefined,
    publicKeyX: string | undefined,
    publicKeyY: string | undefined
  ): { imageBuffer: Buffer; signatureData: ECDSASignatureData } {
    // Validate required fields
    if (!file) {
      throw Errors.badRequest('No image file provided', 'image');
    }

    // Read image buffer
    const imageBuffer = fs.readFileSync(file.path);

    // Validate image buffer
    if (!imageBuffer || imageBuffer.length === 0) {
      throw Errors.badRequest('Image buffer is empty', 'image');
    }

    // Parse and validate ECDSA signature components
    const signatureData = this.verificationService.parseSignatureData(
      signatureR,
      signatureS,
      publicKeyX,
      publicKeyY
    );

    if ('error' in signatureData) {
      throw Errors.badRequest(signatureData.error, 'signature');
    }

    return { imageBuffer, signatureData };
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
      const { signatureR, signatureS, publicKeyX, publicKeyY } = req.body;

      // Validate request and get image buffer
      const { imageBuffer, signatureData } = this.validateUploadRequest(
        file,
        signatureR,
        signatureS,
        publicKeyX,
        publicKeyY
      );

      // Compute SHA256 hash of image
      const sha256Hash = this.verificationService.hashImage(imageBuffer);
      logger.debug({ sha256Hash }, 'Image hash calculated');

      // Check for existing record (duplicate detection)
      const existing = await this.repository.findBySha256Hash(sha256Hash);
      if (existing) {
        logger.info('Duplicate image detected');

        // Clean up uploaded file
        fs.unlinkSync(file!.path);

        res.json({
          tokenOwnerAddress: existing.wallet_address,
          status: 'duplicate',
        });
        return;
      }

      // Verify ECDSA signature and prepare image for proof generation
      logger.debug('Verifying ECDSA signature');
      const verificationResult = this.verificationService.verifyAndPrepareImage(
        file!.path,
        signatureData
      );

      if (!verificationResult.isValid) {
        logger.warn({ error: verificationResult.error }, 'Invalid signature');
        // Clean up uploaded file
        fs.unlinkSync(file!.path);
        throw Errors.badRequest(
          verificationResult.error || 'ECDSA signature verification failed',
          'signature'
        );
      }

      // Generate random token owner address
      const tokenOwnerKey = PrivateKey.random();
      const tokenOwnerAddress = tokenOwnerKey.toPublicKey().toBase58();
      const tokenOwnerPrivate = tokenOwnerKey.toBase58();
      logger.debug({ tokenOwnerAddress }, 'Generated token owner');

      // Insert pending record in database first
      // Note: This is a simplified upload - for TouchGrass challenges, use /api/submissions/create
      await this.repository.create({
        sha256Hash,
        walletAddress: tokenOwnerAddress,
        signature: JSON.stringify({
          r: signatureData.signatureR,
          s: signatureData.signatureS,
        }),
        challengeId: '1', // Default challenge - should be updated when integrated with challenges
        chainId: '1', // Default chain
        storageKey: '', // Will be updated after upload
        tagline: '',
      });

      // Upload image to MinIO
      let storageKey: string;
      try {
        storageKey = await this.storageService.uploadImage(sha256Hash, imageBuffer);
        logger.debug({ storageKey, sha256Hash }, 'Image uploaded to MinIO');

        // Update storage key
        await this.repository.updateBySha256Hash(sha256Hash, { storage_key: storageKey });
      } catch (error) {
        logger.error({ err: error }, 'Failed to upload image to MinIO');
        // Clean up the database record
        await this.repository.delete(sha256Hash);
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
          signature: JSON.stringify({
            r: signatureData.signatureR,
            s: signatureData.signatureS,
          }),
          publicKey: JSON.stringify({
            x: signatureData.publicKeyX,
            y: signatureData.publicKeyY,
          }),
          storageKey,
          tokenOwnerAddress,
          tokenOwnerPrivateKey: tokenOwnerPrivate,
          uploadedAt: new Date(),
          // logging correlation id
          correlationId: (req as Request & { correlationId: string }).correlationId,
        });

        logger.info({ jobId }, 'Proof generation job enqueued');
      } catch (error) {
        logger.error({ err: error }, 'Failed to enqueue job');
        // Clean up the record if job enqueue fails
        await this.repository.delete(sha256Hash);
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
          const existing = await this.repository.findBySha256Hash(sha256Hash);
          if (existing) {
            res.json({
              tokenOwnerAddress: existing.wallet_address,
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
