import { Request, Response, NextFunction } from 'express';
import type { Express } from 'express';
import type {} from 'multer';
import { PublicKey, Signature, PrivateKey } from 'o1js';
import { SubmissionsRepository } from '../db/repositories/submissions.repository.js';
import { UsersRepository } from '../db/repositories/users.repository.js';
import { ChainsRepository } from '../db/repositories/chains.repository.js';
import { ChallengesRepository } from '../db/repositories/challenges.repository.js';
import { ImageAuthenticityService } from '../services/image/verification.service.js';
import { JobQueueService } from '../services/queue/jobQueue.service.js';
import { MinioStorageService } from '../services/storage/minio.service.js';
import { Submission } from '../db/types/touchgrass.types.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';

export interface SubmissionResponse {
  id: string;
  sha256Hash: string;
  walletAddress: string;
  tokenOwnerAddress: string;
  publicKey: string;
  signature: string;
  challengeId: string;
  chainId: string;
  storageKey: string;
  tagline?: string;
  chainPosition: number;
  status: string;
  transactionId?: string;
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
      tokenOwnerAddress: submission.token_owner_address,
      publicKey: submission.public_key,
      signature: submission.signature,
      challengeId: submission.challenge_id,
      chainId: submission.chain_id,
      storageKey: submission.storage_key,
      tagline: submission.tagline || undefined,
      chainPosition: submission.chain_position,
      status: submission.status,
      transactionId: submission.transaction_id || undefined,
      failureReason: submission.failure_reason || undefined,
      retryCount: submission.retry_count,
      challengeVerified: submission.challenge_verified,
      createdAt: new Date(submission.created_at),
      updatedAt: new Date(submission.updated_at),
    };
  }

  private validateSubmissionRequest(
    file: Express.Multer.File | undefined,
    chainId: string | undefined,
    publicKey: string | undefined,
    signature: string | undefined
  ): void {
    if (!file) {
      throw Errors.badRequest('No image file provided', 'image');
    }

    if (!chainId) {
      throw Errors.badRequest('chainId is required', 'chainId');
    }

    if (!publicKey) {
      throw Errors.badRequest('publicKey is required', 'publicKey');
    }

    if (!signature) {
      throw Errors.badRequest('signature is required', 'signature');
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
  }

  async createSubmission(
    req: Request,
    res: Response<SubmissionResponse>,
    next: NextFunction
  ): Promise<void> {
    let storageKey: string | undefined;
    let submission: Submission | undefined;

    try {
      logger.debug('Processing submission request');

      const file = req.file;
      const { chainId, publicKey, signature, tagline } = req.body;

      // Validate request
      this.validateSubmissionRequest(file, chainId, publicKey, signature);

      // Read image buffer
      const imageBuffer = fs.readFileSync(file!.path);
      if (!imageBuffer || imageBuffer.length === 0) {
        throw Errors.badRequest('Image buffer is empty', 'image');
      }

      // todo: rename to wallet address
      const walletAddress = publicKey;

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
        signature,
        publicKey
      );

      if (!verificationResult.isValid) {
        logger.warn({ error: verificationResult.error }, 'Invalid signature');
        throw Errors.badRequest(
          verificationResult.error || 'Signature verification failed',
          'signature'
        );
      }

      // Generate random token owner address
      // todo: use public key, remove token owner key and tokenOwnerPrivate fields in db
      const tokenOwnerKey = PrivateKey.random();
      const tokenOwnerAddress = tokenOwnerKey.toPublicKey().toBase58();
      const tokenOwnerPrivate = tokenOwnerKey.toBase58();
      logger.debug({ tokenOwnerAddress }, 'Generated token owner');

      // Upload image to MinIO
      storageKey = await this.storageService.uploadImage(sha256Hash, imageBuffer);
      logger.debug({ storageKey, sha256Hash }, 'Image uploaded to MinIO');

      // Create submission (with transaction for chain/challenge updates)
      submission = await this.submissionsRepo.create({
        sha256Hash,
        walletAddress,
        tokenOwnerAddress,
        tokenOwnerPrivateKey: tokenOwnerPrivate,
        publicKey,
        signature,
        challengeId: challenge.id,
        chainId: chainId!,
        storageKey,
        tagline,
      });

      // TODO: configure admin approval flow to Enqueue job for proof generation
      // const jobId = await this.jobQueue.enqueueProofGeneration({
      //   sha256Hash,
      //   signature,
      //   publicKey,
      //   storageKey,
      //   tokenOwnerAddress,
      //   tokenOwnerPrivateKey: tokenOwnerPrivate,
      //   uploadedAt: new Date(),
      //   correlationId: (req as Request & { correlationId: string }).correlationId,
      // });
      // logger.info({ jobId, submissionId: submission.id }, 'Proof generation job enqueued');

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
