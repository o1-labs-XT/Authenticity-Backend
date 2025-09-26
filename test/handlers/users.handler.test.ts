import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersHandler } from '../../src/handlers/users.handler.js';

describe('UsersHandler', () => {
  let handler: UsersHandler;
  let mockRepo: any;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockRepo = {
      findByWalletAddress: vi.fn(),
      findOrCreate: vi.fn(),
      delete: vi.fn(),
    };

    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    mockNext = vi.fn();

    handler = new UsersHandler(mockRepo);
  });

  describe('createUser validation', () => {
    it('should require walletAddress field', async () => {
      mockReq = { body: {} };

      await handler.createUser(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'walletAddress is required',
          field: 'walletAddress',
          statusCode: 400,
        })
      );
      expect(mockRepo.findOrCreate).not.toHaveBeenCalled();
    });

    it('should reject invalid wallet address format', async () => {
      mockReq = { body: { walletAddress: 'invalid-wallet' } };

      await handler.createUser(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid wallet address format',
          field: 'walletAddress',
          statusCode: 400,
        })
      );
      expect(mockRepo.findOrCreate).not.toHaveBeenCalled();
    });
  });
});
