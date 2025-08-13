import request from 'supertest';
import { Express } from 'express';
import { createServer } from '../../../src/api/server';
import { MockServices } from '../../utils/mocks';
import { createTestImage } from '../../utils/test-helpers';
import { UploadHandler } from '../../../src/handlers/upload.handler';
import { StatusHandler } from '../../../src/handlers/status.handler';
import { TokenOwnerHandler } from '../../../src/handlers/tokenOwner.handler';
import path from 'path';
import fs from 'fs';
import sinon from 'sinon';

describe('Upload API Integration', () => {
  let app: Express;
  let mockHashingService: any;
  let mockVerificationService: any;
  let mockRepository: any;
  let mockProofGenerationService: any;
  let mockProofPublishingService: any;
  let testImagePath: string;

  beforeEach(() => {
    // Create test image
    const testImageBuffer = Buffer.from('test image data');
    testImagePath = path.join('/tmp', `test-${Date.now()}.png`);
    fs.writeFileSync(testImagePath, testImageBuffer);

    // Create mocks
    mockHashingService = MockServices.createMockHashingService();
    mockVerificationService = MockServices.createMockVerificationService();
    mockRepository = MockServices.createMockRepository();
    mockProofGenerationService = {
      generateProof: sinon.stub().resolves({ proof: 'mock-proof', publicInputs: 'mock-inputs' }),
      compile: sinon.stub(),
      isCompiled: sinon.stub().returns(true)
    };
    mockProofPublishingService = {
      publishProof: sinon.stub().resolves('tx-123'),
      compile: sinon.stub(),
      isDeployed: sinon.stub().returns(true),
      isCompiled: sinon.stub().returns(true)
    };

    // Create handlers
    const uploadHandler = new UploadHandler(
      mockHashingService,
      mockVerificationService,
      mockRepository,
      mockProofGenerationService,
      mockProofPublishingService
    );
    const statusHandler = new StatusHandler(mockRepository);
    const tokenOwnerHandler = new TokenOwnerHandler(mockRepository);

    // Create app
    app = createServer({
      uploadHandler,
      statusHandler,
      tokenOwnerHandler,
    });
  });

  afterEach(() => {
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
  });

  describe('POST /api/upload', () => {
    it('should successfully upload an image', async () => {
      mockHashingService.computeSHA256.returns('test-hash-123');
      mockVerificationService.generateTokenOwnerAddress.returns('B62token-owner-123');
      mockRepository.checkExistingImage.resolves({ exists: false });

      const response = await request(app)
        .post('/api/upload')
        .attach('image', testImagePath)
        .field('publicKey', 'B62test-public-key')
        .field('signature', 'test-signature');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        tokenOwnerAddress: 'B62token-owner-123',
        sha256Hash: 'test-hash-123',
        status: 'pending',
      });
    });

    it('should return 400 for missing image', async () => {
      const response = await request(app)
        .post('/api/upload')
        .field('publicKey', 'B62test-public-key')
        .field('signature', 'test-signature');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.field).toBe('image');
    });

    it('should return 400 for missing public key', async () => {
      const response = await request(app)
        .post('/api/upload')
        .attach('image', testImagePath)
        .field('signature', 'test-signature');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.field).toBe('publicKey');
    });

    it('should return 400 for missing signature', async () => {
      const response = await request(app)
        .post('/api/upload')
        .attach('image', testImagePath)
        .field('publicKey', 'B62test-public-key');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.field).toBe('signature');
    });

    it('should handle duplicate images', async () => {
      mockHashingService.computeSHA256.returns('existing-hash');
      mockRepository.checkExistingImage.resolves({
        exists: true,
        tokenOwnerAddress: 'B62existing-owner',
      });

      const response = await request(app)
        .post('/api/upload')
        .attach('image', testImagePath)
        .field('publicKey', 'B62test-public-key')
        .field('signature', 'test-signature');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        tokenOwnerAddress: 'B62existing-owner',
        status: 'duplicate',
      });
    });

    it('should return 400 for invalid signature', async () => {
      mockHashingService.computeSHA256.returns('test-hash');
      mockRepository.checkExistingImage.resolves({ exists: false });
      mockVerificationService.verifySignature.returns(false);

      const response = await request(app)
        .post('/api/upload')
        .attach('image', testImagePath)
        .field('publicKey', 'B62test-public-key')
        .field('signature', 'invalid-signature');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should handle file size limits', async () => {
      // Create a large buffer (larger than test limit)
      const largeBuffer = Buffer.alloc(2 * 1024 * 1024); // 2MB
      const largeImagePath = path.join('/tmp', `large-${Date.now()}.png`);
      fs.writeFileSync(largeImagePath, largeBuffer);

      try {
        const response = await request(app)
          .post('/api/upload')
          .attach('image', largeImagePath)
          .field('publicKey', 'B62test-public-key')
          .field('signature', 'test-signature');

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('FILE_TOO_LARGE');
      } finally {
        fs.unlinkSync(largeImagePath);
      }
    });
  });

  describe('GET /api/status/:sha256Hash', () => {
    it('should return status for existing record', async () => {
      const hash = 'a'.repeat(64);
      mockRepository.getRecordStatus.resolves({
        status: 'pending',
        tokenOwnerAddress: 'B62token-owner',
        transactionId: null,
        errorMessage: null,
      });

      const response = await request(app)
        .get(`/api/status/${hash}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'pending',
        tokenOwnerAddress: 'B62token-owner',
      });
    });

    it('should return 404 for non-existent record', async () => {
      const hash = 'a'.repeat(64);
      mockRepository.getRecordStatus.resolves(null);

      const response = await request(app)
        .get(`/api/status/${hash}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid hash format', async () => {
      const response = await request(app)
        .get('/api/status/invalid-hash');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/token-owner/:sha256Hash', () => {
    it('should return token owner for existing record', async () => {
      const hash = 'a'.repeat(64);
      mockRepository.getRecordByHash.resolves({
        sha256_hash: hash,
        token_owner_address: 'B62token-owner',
        status: 'verified',
      });

      const response = await request(app)
        .get(`/api/token-owner/${hash}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        tokenOwnerAddress: 'B62token-owner',
        status: 'verified',
        found: true,
      });
    });

    it('should return found=false for non-existent record', async () => {
      const hash = 'a'.repeat(64);
      mockRepository.getRecordByHash.resolves(null);

      const response = await request(app)
        .get(`/api/token-owner/${hash}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        found: false,
      });
    });

    it('should return 400 for invalid hash format', async () => {
      const response = await request(app)
        .get('/api/token-owner/invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeDefined();
    });
  });

  describe('GET /api/version', () => {
    it('should return API version', async () => {
      const response = await request(app)
        .get('/api/version');

      expect(response.status).toBe(200);
      expect(response.body.version).toBe('1.0.0');
      expect(response.body.api).toBe('Provenance Backend API');
    });
  });

  describe('GET /api/statistics', () => {
    it('should return statistics', async () => {
      mockRepository.getStatistics.resolves({
        total: 10,
        pending: 3,
        verified: 6,
        failed: 1,
      });

      const response = await request(app)
        .get('/api/statistics');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        total: 10,
        pending: 3,
        verified: 6,
        failed: 1,
      });
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await request(app)
        .get('/api/unknown-endpoint');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });
});