import { Request, Response, NextFunction, Express } from 'express';
import type {} from 'multer';
import { PrivateKey, PublicKey } from 'o1js';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { UsersRepository } from '../db/repositories/users.repository.js';
import { ChainsRepository } from '../db/repositories/chains.repository.js';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import {
  ImageAuthenticityService,
  ECDSASignatureData,
} from '../services/image/verification.service.js';
import { JobQueueService } from '../services/queue/jobQueue.service.js';
import { MinioStorageService } from '../services/storage/minio.service.js';
import { Submission } from '../db/types/touchgrass.types.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';

export interface SubmissionResponse {
  id: string;
  sha256Hash: string;
  walletAddress: string; // User's wallet address (public key)
  signature: string;
  challengeId: string;
  chainId: string;
  storageKey: string;
  tagline?: string;
  chainPosition: number;
  status: string;
  transactionId?: string;
  transactionSubmittedBlockHeight?: number;
  failureReason?: string;
  retryCount: number;
  challengeVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class SubmissionsHandler {
  constructor(
    private readonly submissionsRepo: SubmissionsRepository,
    private readonly usersRepo: UsersRepository,
    private readonly chainsRepo: ChainsRepository,
    private readonly challengesRepo: ChallengesRepository,
    private readonly verificationService: ImageAuthenticityService,
    private readonly jobQueue: JobQueueService,
    private readonly storageService: MinioStorageService
  ) {}

  private toResponse(submission: Submission): SubmissionResponse {
    return {
      id: submission.id,
      sha256Hash: submission.sha256_hash,
      walletAddress: submission.wallet_address,
      signature: submission.signature,
      challengeId: submission.challenge_id,
      chainId: submission.chain_id,
      storageKey: submission.storage_key,
      tagline: submission.tagline || undefined,
      chainPosition: submission.chain_position,
      status: submission.status,
      transactionId: submission.transaction_id || undefined,
      transactionSubmittedBlockHeight: submission.transaction_submitted_block_height || undefined,
      failureReason: submission.failure_reason || undefined,
      retryCount: submission.retry_count,
      challengeVerified: submission.challenge_verified,
      createdAt: new Date(submission.created_at),
      updatedAt: new Date(submission.updated_at),
    };
  }

  // todo: update unit tests for request validation
  private validateSubmissionRequest(
    file: Express.Multer.File | undefined,
    chainId: string | undefined,
    walletAddress: string | undefined,
    signatureR: string | undefined,
    signatureS: string | undefined,
    publicKeyX: string | undefined,
    publicKeyY: string | undefined
  ): { imageBuffer: Buffer; signatureData: ECDSASignatureData } {
    if (!file) {
      throw Errors.badRequest('No image file provided', 'image');
    }

    if (!chainId) {
      throw Errors.badRequest('chainId is required', 'chainId');
    }

    if (!walletAddress) {
      throw Errors.badRequest('walletAddress is required', 'walletAddress');
    }

    // Validate wallet address format (it's a public key in base58)
    try {
      PublicKey.fromBase58(walletAddress);
    } catch {
      throw Errors.badRequest('Invalid wallet address format', 'walletAddress');
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

  async createSubmission(
    req: Request,
    res: Response<SubmissionResponse>,
    next: NextFunction
  ): Promise<void> {
    let storageKey: string | undefined;

    try {
      logger.debug('Processing submission request');

      const file = req.file;
      const { chainId, walletAddress, signatureR, signatureS, publicKeyX, publicKeyY, tagline } =
        req.body;

      // Validate request and get image buffer and signature data
      const { imageBuffer, signatureData } = this.validateSubmissionRequest(
        file,
        chainId,
        walletAddress,
        signatureR,
        signatureS,
        publicKeyX,
        publicKeyY
      );

      // Compute SHA256 hash of image
      const sha256Hash = this.verificationService.hashImage(imageBuffer);
      logger.debug({ sha256Hash }, 'Image hash calculated');

      // Get chain and challenge
      const chain = await this.chainsRepo.findById(chainId!);
      if (!chain) {
        throw Errors.notFound('Chain');
      }
      const challenge = await this.challengesRepo.findById(chain.challenge_id);
      if (!challenge) {
        throw Errors.notFound('Challenge');
      }

      // Verify challenge is active
      const now = new Date();
      const startTime = new Date(challenge.start_time);
      const endTime = new Date(challenge.end_time);
      if (now < startTime || now >= endTime) {
        throw Errors.badRequest('Challenge is not currently active');
      }

      // Ensure user exists
      await this.usersRepo.findOrCreate(walletAddress);

      // Verify signature
      logger.debug('Verifying signature');
      const verificationResult = this.verificationService.verifyAndPrepareImage(
        file!.path,
        signatureData
      );

      if (!verificationResult.isValid) {
        logger.warn({ error: verificationResult.error }, 'Invalid signature');
        throw Errors.badRequest(
          verificationResult.error || 'Signature verification failed',
          'signature'
        );
      }

      // Upload image to MinIO
      storageKey = await this.storageService.uploadImage(sha256Hash, imageBuffer);
      logger.debug({ storageKey, sha256Hash }, 'Image uploaded to MinIO');

      // Create submission (with transaction for chain/challenge updates)
      let submission = await this.submissionsRepo.create({
        sha256Hash,
        walletAddress,
        signature: JSON.stringify({
          r: signatureData.signatureR,
          s: signatureData.signatureS,
        }),
        challengeId: challenge.id,
        chainId: chainId!,
        storageKey,
        tagline,
      });

      // Note: Proof generation job will be enqueued after admin approval in reviewSubmission()
      logger.info(
        { submissionId: submission.id, sha256Hash },
        'Submission created, awaiting admin review'
      );

      res.status(201).json(this.toResponse(submission));
    } catch (error) {
      logger.error({ err: error }, 'Submission handler error');

      // Clean up MinIO if upload succeeded but database failed
      if (storageKey) {
        await this.storageService.deleteImage(storageKey).catch((err) => {
          logger.warn({ err }, 'Failed to delete MinIO image during cleanup');
        });
      }

      next(error);
    } finally {
      // Always clean up temp file
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }
  }

  async getSubmission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const submission = await this.submissionsRepo.findById(id);
      if (!submission) {
        throw Errors.notFound('Submission');
      }

      res.json(this.toResponse(submission));
    } catch (error) {
      next(error);
    }
  }

  async getSubmissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { walletAddress, chainId, challengeId, status } = req.query;

      const submissions = await this.submissionsRepo.findAll({
        walletAddress: walletAddress as string | undefined,
        chainId: chainId as string | undefined,
        challengeId: challengeId as string | undefined,
        status: status as string | undefined,
      });

      res.json(submissions.map((s) => this.toResponse(s)));
    } catch (error) {
      next(error);
    }
  }

  async reviewSubmission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { challengeVerified, failureReason } = req.body;

      if (challengeVerified === undefined) {
        throw Errors.badRequest('challengeVerified is required', 'challengeVerified');
      }

      // Check submission exists and is in correct state
      const submission = await this.submissionsRepo.findById(id);
      if (!submission) {
        throw Errors.notFound('Submission');
      }

      if (submission.status !== 'awaiting_review') {
        throw Errors.badRequest(
          `Submission cannot be reviewed in status: ${submission.status}`,
          'status'
        );
      }

      const updates: Partial<Submission> = {
        challenge_verified: challengeVerified,
        status: challengeVerified ? 'processing' : 'rejected',
        failure_reason: challengeVerified
          ? null
          : failureReason || 'Image does not satisfy challenge criteria',
      };

      // Enqueue proof generation job if approved
      if (challengeVerified) {
        // Extract public key from wallet address (it's stored as base58)
        const publicKey = PublicKey.fromBase58(submission.wallet_address);
        const publicKeyGroup = publicKey.toGroup();
        const publicKeyJson = JSON.stringify({
          x: publicKeyGroup.x.toString(),
          y: publicKeyGroup.y.toString(),
        });

        const jobId = await this.jobQueue.enqueueProofGeneration({
          sha256Hash: submission.sha256_hash,
          signature: submission.signature,
          publicKey: publicKeyJson,
          storageKey: submission.storage_key,
          tokenOwnerAddress: submission.wallet_address,
          tokenOwnerPrivateKey: PrivateKey.random().toBase58(),
          uploadedAt: new Date(submission.created_at),
          correlationId: (req as Request & { correlationId: string }).correlationId,
        });
        logger.info({ jobId, submissionId: id }, 'Proof generation job enqueued after approval');
      }

      const updated = await this.submissionsRepo.update(id, updates);
      if (!updated) {
        throw Errors.notFound('Submission');
      }

      res.json(this.toResponse(updated));
    } catch (error) {
      next(error);
    }
  }

  async getSubmissionImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const submission = await this.submissionsRepo.findById(id);
      if (!submission) {
        throw Errors.notFound('Submission');
      }

      const imageBuffer = await this.storageService.downloadImage(submission.storage_key);

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(imageBuffer);
    } catch (error) {
      next(error);
    }
  }

  async deleteSubmission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const deleted = await this.submissionsRepo.delete(id);
      if (!deleted) {
        throw Errors.notFound('Submission');
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
