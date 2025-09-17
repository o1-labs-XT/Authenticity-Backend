import { describe, it, expect, vi } from 'vitest';
import { AuthenticityRepository } from '../../src/db/repositories/authenticity.repository.js';

describe('AuthenticityRepository', () => {
  const createMockAdapter = (overrides: any = {}) => ({
    getRecordByHash: vi.fn().mockResolvedValue(null),
    createRecord: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  describe('checkExistingImage', () => {
    it('should transform snake_case to camelCase', async () => {
      const record = {
        sha256_hash: 'test-hash',
        token_owner_address: 'B62qtest...',
        status: 'verified',
      };
      const mockAdapter = createMockAdapter({
        getRecordByHash: vi.fn().mockResolvedValue(record),
      });
      const repository = new AuthenticityRepository(mockAdapter as any);

      const result = await repository.checkExistingImage('test-hash');

      expect(result).toEqual({
        exists: true,
        tokenOwnerAddress: record.token_owner_address,
        status: record.status,
      });
    });
  });

  describe('insertPendingRecord', () => {
    it('should transform camelCase to snake_case', async () => {
      const mockAdapter = createMockAdapter();
      const repository = new AuthenticityRepository(mockAdapter as any);

      await repository.insertPendingRecord({
        sha256Hash: 'hash123',
        tokenOwnerAddress: 'B62qOwner',
        tokenOwnerPrivate: 'privateKey',
        creatorPublicKey: 'B62qCreator',
        signature: 'sig123',
      });

      expect(mockAdapter.createRecord).toHaveBeenCalledWith({
        sha256_hash: 'hash123',
        token_owner_address: 'B62qOwner',
        token_owner_private_key: 'privateKey',
        creator_public_key: 'B62qCreator',
        signature: 'sig123',
        status: 'pending',
        transaction_id: null,
      });
    });

    it('should transform database constraint errors', async () => {
      const postgresError = new Error('duplicate key value') as any;
      postgresError.code = '23505';

      const mockAdapter = createMockAdapter({
        createRecord: vi.fn().mockRejectedValue(postgresError),
      });
      const repository = new AuthenticityRepository(mockAdapter as any);

      await expect(
        repository.insertPendingRecord({
          sha256Hash: 'duplicate',
          tokenOwnerAddress: 'B62qOwner',
          tokenOwnerPrivate: 'privateKey',
          creatorPublicKey: 'B62qCreator',
          signature: 'sig123',
        })
      ).rejects.toThrow('Record with this SHA256 hash already exists');
    });
  });
});
