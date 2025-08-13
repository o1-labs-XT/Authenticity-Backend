import { DatabaseConnection } from '../../../src/db/database';
import { AuthenticityRepository } from '../../../src/db/repositories/authenticity.repository';
import { createTestDatabase, createMockAuthenticityRecord } from '../../utils/test-helpers';

describe('AuthenticityRepository', () => {
  let db: DatabaseConnection;
  let repository: AuthenticityRepository;

  beforeEach(() => {
    db = createTestDatabase();
    repository = new AuthenticityRepository(db.getDb());
  });

  afterEach(() => {
    db.close();
  });

  describe('insertPendingRecord', () => {
    it('should insert a new pending record', async () => {
      const record = createMockAuthenticityRecord();
      
      await repository.insertPendingRecord(record);
      
      const result = await repository.getRecordByHash(record.sha256Hash);
      expect(result).toBeTruthy();
      expect(result?.sha256_hash).toBe(record.sha256Hash);
      expect(result?.token_owner_address).toBe(record.tokenOwnerAddress);
      expect(result?.status).toBe('pending');
    });

    it('should throw error for duplicate SHA256 hash', async () => {
      const record = createMockAuthenticityRecord();
      
      await repository.insertPendingRecord(record);
      
      await expect(repository.insertPendingRecord(record))
        .rejects.toThrow('Record with this SHA256 hash already exists');
    });
  });

  describe('checkExistingImage', () => {
    it('should return exists=false for non-existent image', async () => {
      const result = await repository.checkExistingImage('non-existent-hash');
      
      expect(result.exists).toBe(false);
      expect(result.tokenOwnerAddress).toBeUndefined();
    });

    it('should return exists=true with token owner for existing image', async () => {
      const record = createMockAuthenticityRecord();
      await repository.insertPendingRecord(record);
      
      const result = await repository.checkExistingImage(record.sha256Hash);
      
      expect(result.exists).toBe(true);
      expect(result.tokenOwnerAddress).toBe(record.tokenOwnerAddress);
      expect(result.status).toBe('pending');
    });
  });

  describe('updateRecordStatus', () => {
    it('should update status to verified with transaction ID', async () => {
      const record = createMockAuthenticityRecord();
      await repository.insertPendingRecord(record);
      
      await repository.updateRecordStatus(record.sha256Hash, {
        status: 'verified',
        transactionId: 'tx-123',
        proofData: { proof: 'test' },
      });
      
      const updated = await repository.getRecordByHash(record.sha256Hash);
      expect(updated?.status).toBe('verified');
      expect(updated?.transaction_id).toBe('tx-123');
      expect(updated?.verified_at).toBeTruthy();
      expect(JSON.parse(updated?.proof_data || '{}')).toEqual({ proof: 'test' });
    });

    it('should update status to failed with error message', async () => {
      const record = createMockAuthenticityRecord();
      await repository.insertPendingRecord(record);
      
      await repository.updateRecordStatus(record.sha256Hash, {
        status: 'failed',
        errorMessage: 'Test error',
      });
      
      const updated = await repository.getRecordByHash(record.sha256Hash);
      expect(updated?.status).toBe('failed');
      expect(updated?.error_message).toBe('Test error');
      expect(updated?.verified_at).toBeNull();
    });

    it('should throw error for non-existent record', async () => {
      await expect(repository.updateRecordStatus('non-existent', {
        status: 'verified',
      })).rejects.toThrow('No record found with hash: non-existent');
    });
  });

  describe('getRecordStatus', () => {
    it('should return status information for existing record', async () => {
      const record = createMockAuthenticityRecord();
      await repository.insertPendingRecord(record);
      
      const status = await repository.getRecordStatus(record.sha256Hash);
      
      expect(status).toBeTruthy();
      expect(status?.status).toBe('pending');
      expect(status?.tokenOwnerAddress).toBe(record.tokenOwnerAddress);
    });

    it('should return null for non-existent record', async () => {
      const status = await repository.getRecordStatus('non-existent');
      expect(status).toBeNull();
    });
  });

  describe('deleteFailedRecord', () => {
    it('should delete a failed record', async () => {
      const record = createMockAuthenticityRecord();
      await repository.insertPendingRecord(record);
      await repository.updateRecordStatus(record.sha256Hash, {
        status: 'failed',
      });
      
      const deleted = await repository.deleteFailedRecord(record.sha256Hash);
      expect(deleted).toBe(true);
      
      const result = await repository.getRecordByHash(record.sha256Hash);
      expect(result).toBeNull();
    });

    it('should not delete non-failed records', async () => {
      const record = createMockAuthenticityRecord();
      await repository.insertPendingRecord(record);
      
      const deleted = await repository.deleteFailedRecord(record.sha256Hash);
      expect(deleted).toBe(false);
      
      const result = await repository.getRecordByHash(record.sha256Hash);
      expect(result).toBeTruthy();
    });
  });

  describe('getPendingRecords', () => {
    it('should return only pending records', async () => {
      const pending1 = createMockAuthenticityRecord({ status: 'pending' });
      const pending2 = createMockAuthenticityRecord({ status: 'pending' });
      const verified = createMockAuthenticityRecord({ status: 'pending' });
      
      await repository.insertPendingRecord(pending1);
      await repository.insertPendingRecord(pending2);
      await repository.insertPendingRecord(verified);
      
      await repository.updateRecordStatus(verified.sha256Hash, {
        status: 'verified',
      });
      
      const pendingRecords = await repository.getPendingRecords();
      
      expect(pendingRecords).toHaveLength(2);
      expect(pendingRecords.map(r => r.sha256_hash)).toContain(pending1.sha256Hash);
      expect(pendingRecords.map(r => r.sha256_hash)).toContain(pending2.sha256Hash);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await repository.insertPendingRecord(createMockAuthenticityRecord());
      }
      
      const records = await repository.getPendingRecords(3);
      expect(records).toHaveLength(3);
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', async () => {
      const pending1 = createMockAuthenticityRecord();
      const pending2 = createMockAuthenticityRecord();
      const verified = createMockAuthenticityRecord();
      const failed = createMockAuthenticityRecord();
      
      await repository.insertPendingRecord(pending1);
      await repository.insertPendingRecord(pending2);
      await repository.insertPendingRecord(verified);
      await repository.insertPendingRecord(failed);
      
      await repository.updateRecordStatus(verified.sha256Hash, { status: 'verified' });
      await repository.updateRecordStatus(failed.sha256Hash, { status: 'failed' });
      
      const stats = await repository.getStatistics();
      
      expect(stats.total).toBe(4);
      expect(stats.pending).toBe(2);
      expect(stats.verified).toBe(1);
      expect(stats.failed).toBe(1);
    });

    it('should return zeros for empty database', async () => {
      const stats = await repository.getStatistics();
      
      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.verified).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  describe('transaction', () => {
    it('should execute operations in transaction', async () => {
      const record1 = createMockAuthenticityRecord();
      const record2 = createMockAuthenticityRecord();
      
      // Note: better-sqlite3 transactions are synchronous
      repository.transaction(() => {
        // These operations are synchronous in better-sqlite3
        const stmt = db.getDb().prepare(`
          INSERT INTO authenticity_records 
          (sha256_hash, token_owner_address, creator_public_key, signature, status)
          VALUES (?, ?, ?, ?, 'pending')
        `);
        stmt.run(record1.sha256Hash, record1.tokenOwnerAddress, record1.creatorPublicKey, record1.signature);
        stmt.run(record2.sha256Hash, record2.tokenOwnerAddress, record2.creatorPublicKey, record2.signature);
      });
      
      const result1 = await repository.getRecordByHash(record1.sha256Hash);
      const result2 = await repository.getRecordByHash(record2.sha256Hash);
      
      expect(result1).toBeTruthy();
      expect(result2).toBeTruthy();
    });

    it('should rollback transaction on error', async () => {
      const record = createMockAuthenticityRecord();
      
      let errorThrown = false;
      try {
        repository.transaction(() => {
          const stmt = db.getDb().prepare(`
            INSERT INTO authenticity_records 
            (sha256_hash, token_owner_address, creator_public_key, signature, status)
            VALUES (?, ?, ?, ?, 'pending')
          `);
          stmt.run(record.sha256Hash, record.tokenOwnerAddress, record.creatorPublicKey, record.signature);
          // This should fail (duplicate)
          stmt.run(record.sha256Hash, record.tokenOwnerAddress, record.creatorPublicKey, record.signature);
        });
      } catch (error) {
        errorThrown = true;
        // Expected to fail
      }
      
      expect(errorThrown).toBe(true);
      const result = await repository.getRecordByHash(record.sha256Hash);
      expect(result).toBeNull(); // Should be rolled back
    });
  });
});