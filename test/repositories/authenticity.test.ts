import { describe, it, expect, vi } from 'vitest';
import { AuthenticityRepository } from '../../src/db/repositories/authenticity.repository.js';

describe('AuthenticityRepository', () => {
  const createMockAdapter = (returnValue: any = null) => ({
    getRecordByHash: vi.fn().mockResolvedValue(returnValue),
  });
  describe('checkExistingImage', () => {
    it('should return exists: false when no record found', async () => {
      const mockAdapter = createMockAdapter();
      const repository = new AuthenticityRepository(mockAdapter as any);

      const result = await repository.checkExistingImage('test-hash');

      expect(result).toEqual({ exists: false });
    });

    it('should return exists: true with details when record found', async () => {
      const record = {
        sha256_hash: 'test-hash',
        token_owner_address: 'B62qtest...',
        status: 'verified',
      };
      const mockAdapter = createMockAdapter(record);
      const repository = new AuthenticityRepository(mockAdapter as any);

      const result = await repository.checkExistingImage('test-hash');

      expect(result).toEqual({
        exists: true,
        tokenOwnerAddress: record.token_owner_address,
        status: record.status,
      });
    });
  });
});
