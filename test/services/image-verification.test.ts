import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageAuthenticityService } from '../../src/services/image/verification.service.js';
import { createHash } from 'crypto';
import { Signature, Field, PrivateKey } from 'o1js';

vi.mock('authenticity-zkapp', () => ({
  hashImageOffCircuit: vi.fn((buffer: Buffer) => {
    return createHash('sha256').update(buffer).digest('hex');
  }),
  prepareImageVerification: vi.fn(),
}));

import { prepareImageVerification } from 'authenticity-zkapp';

describe('ImageAuthenticityService', () => {
  const service = new ImageAuthenticityService();

  describe('hashImage', () => {
    it('should compute SHA256 hash', () => {
      const testBuffer = Buffer.from('test image data');
      const expectedHash = createHash('sha256').update(testBuffer).digest('hex');

      expect(service.hashImage(testBuffer)).toBe(expectedHash);
    });
  });

  describe('verifyAndPrepareImage', () => {
    const imagePath = '/path/to/test.jpg';
    let validSignature: string;
    let validPublicKey: string;
    let expectedHash: Field;

    beforeEach(() => {
      vi.clearAllMocks();

      const privateKey = PrivateKey.random();
      expectedHash = Field(123456789);
      validSignature = Signature.create(privateKey, expectedHash.toFields()).toBase58();
      validPublicKey = privateKey.toPublicKey().toBase58();

      vi.mocked(prepareImageVerification).mockReturnValue({
        expectedHash,
        penultimateState: Array(8).fill(0),
        initialState: Array(8).fill(0),
        messageWord: 0,
        roundConstant: 0,
      } as any);
    });

    it('should accept valid signature and return verification inputs', () => {
      const result = service.verifyAndPrepareImage(imagePath, validSignature, validPublicKey);

      expect(result.isValid).toBe(true);
      expect(result.verificationInputs?.expectedHash).toEqual(expectedHash);
      expect(prepareImageVerification).toHaveBeenCalledWith(imagePath);
    });

    it('should reject signature from different key', () => {
      const differentKey = PrivateKey.random();
      const invalidSignature = Signature.create(differentKey, expectedHash.toFields()).toBase58();

      const result = service.verifyAndPrepareImage(imagePath, invalidSignature, validPublicKey);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Signature does not match image hash');
    });

    it('should handle invalid base58 formats', () => {
      const result = service.verifyAndPrepareImage(imagePath, 'invalid-signature', validPublicKey);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('invalid');
    });

    it('should handle prepareImageVerification errors', () => {
      vi.mocked(prepareImageVerification).mockImplementation(() => {
        throw new Error('Failed to read image file');
      });

      const result = service.verifyAndPrepareImage(imagePath, validSignature, validPublicKey);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Failed to read image file');
    });
  });
});
