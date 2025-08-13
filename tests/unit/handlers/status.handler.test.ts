import { StatusHandler } from '../../../src/handlers/status.handler';
import { MockServices, MockHttp } from '../../utils/mocks';
import sinon from 'sinon';

describe('StatusHandler', () => {
  let statusHandler: StatusHandler;
  let mockRepository: any;

  beforeEach(() => {
    mockRepository = MockServices.createMockRepository();
    statusHandler = new StatusHandler(mockRepository);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getStatus', () => {
    it('should return status for existing record', async () => {
      const req = MockHttp.createMockRequest({
        params: { sha256Hash: 'a'.repeat(64) },
      });
      const res = MockHttp.createMockResponse();

      mockRepository.getRecordStatus.resolves({
        status: 'pending',
        tokenOwnerAddress: 'B62token-owner',
        transactionId: null,
        errorMessage: null,
      });

      await statusHandler.getStatus(req, res);

      expect(res.json.calledOnce).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        status: 'pending',
        tokenOwnerAddress: 'B62token-owner',
        transactionId: undefined,
        errorMessage: undefined,
      });
    });

    it('should return status with transaction ID for verified record', async () => {
      const req = MockHttp.createMockRequest({
        params: { sha256Hash: 'a'.repeat(64) },
      });
      const res = MockHttp.createMockResponse();

      mockRepository.getRecordStatus.resolves({
        status: 'verified',
        tokenOwnerAddress: 'B62token-owner',
        transactionId: 'tx-123',
        errorMessage: null,
      });

      await statusHandler.getStatus(req, res);

      expect(res.json.firstCall.args[0]).toEqual({
        status: 'verified',
        tokenOwnerAddress: 'B62token-owner',
        transactionId: 'tx-123',
        errorMessage: undefined,
      });
    });

    it('should return status with error message for failed record', async () => {
      const req = MockHttp.createMockRequest({
        params: { sha256Hash: 'a'.repeat(64) },
      });
      const res = MockHttp.createMockResponse();

      mockRepository.getRecordStatus.resolves({
        status: 'failed',
        tokenOwnerAddress: 'B62token-owner',
        transactionId: null,
        errorMessage: 'Proof generation failed',
      });

      await statusHandler.getStatus(req, res);

      expect(res.json.firstCall.args[0]).toEqual({
        status: 'failed',
        tokenOwnerAddress: 'B62token-owner',
        transactionId: undefined,
        errorMessage: 'Proof generation failed',
      });
    });

    it('should return 404 for non-existent record', async () => {
      const req = MockHttp.createMockRequest({
        params: { sha256Hash: 'a'.repeat(64) },
      });
      const res = MockHttp.createMockResponse();

      mockRepository.getRecordStatus.resolves(null);

      await statusHandler.getStatus(req, res);

      expect(res.status.calledWith(404)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'No record found for this SHA256 hash',
        },
      });
    });

    it('should validate SHA256 hash format', async () => {
      const req = MockHttp.createMockRequest({
        params: { sha256Hash: 'invalid-hash' },
      });
      const res = MockHttp.createMockResponse();

      await statusHandler.getStatus(req, res);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid SHA256 hash format',
          field: 'sha256Hash',
        },
      });
    });

    it('should handle missing hash parameter', async () => {
      const req = MockHttp.createMockRequest({
        params: {},
      });
      const res = MockHttp.createMockResponse();

      await statusHandler.getStatus(req, res);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid SHA256 hash format',
          field: 'sha256Hash',
        },
      });
    });

    it('should handle repository errors', async () => {
      const req = MockHttp.createMockRequest({
        params: { sha256Hash: 'a'.repeat(64) },
      });
      const res = MockHttp.createMockResponse();

      mockRepository.getRecordStatus.rejects(new Error('Database error'));

      await statusHandler.getStatus(req, res);

      expect(res.status.calledWith(500)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve status',
        },
      });
    });
  });

  describe('getStatistics', () => {
    it('should return database statistics', async () => {
      const req = MockHttp.createMockRequest();
      const res = MockHttp.createMockResponse();

      mockRepository.getStatistics.resolves({
        total: 100,
        pending: 20,
        verified: 75,
        failed: 5,
      });

      await statusHandler.getStatistics(req, res);

      expect(res.json.calledOnce).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        total: 100,
        pending: 20,
        verified: 75,
        failed: 5,
      });
    });

    it('should handle statistics errors', async () => {
      const req = MockHttp.createMockRequest();
      const res = MockHttp.createMockResponse();

      mockRepository.getStatistics.rejects(new Error('Database error'));

      await statusHandler.getStatistics(req, res);

      expect(res.status.calledWith(500)).toBe(true);
      expect(res.json.firstCall.args[0]).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve statistics',
        },
      });
    });
  });
});