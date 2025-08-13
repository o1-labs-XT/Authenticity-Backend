import { UploadHandler } from '../../../src/handlers/upload.handler';
import { MockServices, MockHttp } from '../../utils/mocks';
import { createTestImage } from '../../utils/test-helpers';
import sinon from 'sinon';

describe('UploadHandler', () => {
  let uploadHandler: UploadHandler;
  let mockHashingService: any;
  let mockVerificationService: any;
  let mockRepository: any;
  let mockProofGenerationService: any;
  let mockProofPublishingService: any;
  let testImage: ReturnType<typeof createTestImage>;

  beforeEach(() => {
    mockHashingService = MockServices.createMockHashingService();
    mockVerificationService = MockServices.createMockVerificationService();
    mockRepository = MockServices.createMockRepository();
    mockProofGenerationService = {
      generateProof: sinon.stub(),
      compile: sinon.stub(),
      isCompiled: sinon.stub().returns(true)
    };
    mockProofPublishingService = {
      publishProof: sinon.stub(),
      compile: sinon.stub(),
      isDeployed: sinon.stub().returns(true),
      isCompiled: sinon.stub().returns(true)
    };
    
    uploadHandler = new UploadHandler(
      mockHashingService,
      mockVerificationService,
      mockRepository,
      mockProofGenerationService,
      mockProofPublishingService
    );

    testImage = createTestImage();
  });

  afterEach(() => {
    testImage.cleanup();
    sinon.restore();
  });

  describe('handleUpload', () => {
    it('should successfully handle valid image upload', async () => {
      const req = MockHttp.createMockRequest({
        file: {
          path: testImage.path,
          mimetype: 'image/png',
        },
        body: {
          publicKey: 'B62valid-public-key',
          signature: 'valid-signature',
        },
      });
      const res = MockHttp.createMockResponse();

      mockHashingService.computeSHA256.returns('test-hash');
      mockRepository.checkExistingImage.resolves({ exists: false });
      mockVerificationService.generateTokenOwnerAddress.returns('B62token-owner');
      mockProofGenerationService.generateProof.resolves({
        proof: 'mock-proof',
        publicInputs: 'mock-inputs'
      });
      mockProofPublishingService.publishProof.resolves('tx-123');

      await uploadHandler.handleUpload(req, res);

      expect(res.json.calledOnce).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        tokenOwnerAddress: 'B62token-owner',
        sha256Hash: 'test-hash',
        status: 'pending',
      });
      expect(mockRepository.insertPendingRecord.calledOnce).toBe(true);
    });

    it('should return error when no image file provided', async () => {
      const req = MockHttp.createMockRequest({
        body: {
          publicKey: 'B62valid-public-key',
          signature: 'valid-signature',
        },
      });
      const res = MockHttp.createMockResponse();

      await uploadHandler.handleUpload(req, res);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No image file provided',
          field: 'image',
        },
      });
    });

    it('should return error when public key is missing', async () => {
      const req = MockHttp.createMockRequest({
        file: {
          path: testImage.path,
          mimetype: 'image/png',
        },
        body: {
          signature: 'valid-signature',
        },
      });
      const res = MockHttp.createMockResponse();

      await uploadHandler.handleUpload(req, res);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Public key is required',
          field: 'publicKey',
        },
      });
    });

    it('should return error when signature is missing', async () => {
      const req = MockHttp.createMockRequest({
        file: {
          path: testImage.path,
          mimetype: 'image/png',
        },
        body: {
          publicKey: 'B62valid-public-key',
        },
      });
      const res = MockHttp.createMockResponse();

      await uploadHandler.handleUpload(req, res);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Signature is required',
          field: 'signature',
        },
      });
    });

    it('should handle duplicate image detection', async () => {
      const req = MockHttp.createMockRequest({
        file: {
          path: testImage.path,
          mimetype: 'image/png',
        },
        body: {
          publicKey: 'B62valid-public-key',
          signature: 'valid-signature',
        },
      });
      const res = MockHttp.createMockResponse();

      mockHashingService.computeSHA256.returns('existing-hash');
      mockRepository.checkExistingImage.resolves({
        exists: true,
        tokenOwnerAddress: 'B62existing-token-owner',
      });

      await uploadHandler.handleUpload(req, res);

      expect(res.json.calledOnce).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        tokenOwnerAddress: 'B62existing-token-owner',
        status: 'duplicate',
      });
      expect(mockRepository.insertPendingRecord.called).toBe(false);
    });

    it('should return error for invalid signature', async () => {
      const req = MockHttp.createMockRequest({
        file: {
          path: testImage.path,
          mimetype: 'image/png',
        },
        body: {
          publicKey: 'B62valid-public-key',
          signature: 'invalid-signature',
        },
      });
      const res = MockHttp.createMockResponse();

      mockHashingService.computeSHA256.returns('test-hash');
      mockRepository.checkExistingImage.resolves({ exists: false });
      mockVerificationService.verifySignature.returns(false);

      await uploadHandler.handleUpload(req, res);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Signature does not match image hash',
        },
      });
    });

    it('should handle validation errors', async () => {
      const req = MockHttp.createMockRequest({
        file: {
          path: testImage.path,
          mimetype: 'image/png',
        },
        body: {
          publicKey: 'invalid-key',
          signature: 'invalid-sig',
        },
      });
      const res = MockHttp.createMockResponse();

      mockVerificationService.validateInputs.returns({
        valid: false,
        error: 'Invalid public key format',
      });

      await uploadHandler.handleUpload(req, res);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid public key format',
        },
      });
    });

    it('should handle internal errors gracefully', async () => {
      const req = MockHttp.createMockRequest({
        file: {
          path: testImage.path,
          mimetype: 'image/png',
        },
        body: {
          publicKey: 'B62valid-public-key',
          signature: 'valid-signature',
        },
      });
      const res = MockHttp.createMockResponse();

      mockHashingService.computeSHA256.throws(new Error('Hashing failed'));

      await uploadHandler.handleUpload(req, res);

      expect(res.status.calledWith(500)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process upload',
        },
      });
    });
  });
});