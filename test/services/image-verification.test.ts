import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ImageAuthenticityService,
  ECDSASignatureData,
} from '../../src/services/image/verification.service.js';
import { createHash } from 'crypto';
import { UInt32 } from 'o1js';

// Mock the ECDSA classes
const mockEcdsa = {
  verifySignedHash: vi.fn().mockReturnValue({ toBoolean: () => true }),
};
const mockSecp256r1 = {};

vi.mock('authenticity-zkapp', () => ({
  hashImageOffCircuit: vi.fn((buffer: Buffer) => {
    return createHash('sha256').update(buffer).digest('hex');
  }),
  prepareImageVerification: vi.fn(),
  generateECKeyPair: vi.fn(),
  computeOnChainCommitment: vi.fn(),
  Secp256r1: vi.fn(() => mockSecp256r1),
  Ecdsa: vi.fn(() => mockEcdsa),
  Bytes32: {
    fromHex: vi.fn(),
  },
}));

import { prepareImageVerification, Bytes32 } from 'authenticity-zkapp';

describe('ImageAuthenticityService', () => {
  const service = new ImageAuthenticityService();

  describe('hashImage', () => {
    it('should compute SHA256 hash', () => {
      const testBuffer = Buffer.from('test image data');
      const expectedHash = createHash('sha256').update(testBuffer).digest('hex');

      expect(service.hashImage(testBuffer)).toBe(expectedHash);
    });
  });

  describe('parseSignatureData', () => {
    it('should parse valid ECDSA signature components', () => {
      const signatureR = '1234567890abcdef'.repeat(4); // 64 chars
      const signatureS = 'fedcba0987654321'.repeat(4); // 64 chars
      const publicKeyX = 'abcdef1234567890'.repeat(4); // 64 chars
      const publicKeyY = '0987654321fedcba'.repeat(4); // 64 chars

      const result = service.parseSignatureData(signatureR, signatureS, publicKeyX, publicKeyY);

      expect(result).toEqual({
        signatureR,
        signatureS,
        publicKeyX,
        publicKeyY,
      });
    });

    it('should reject missing components', () => {
      const result = service.parseSignatureData('abc', undefined, 'def', 'ghi');
      expect(result).toEqual({ error: 'Missing required signature components' });
    });

    it('should reject invalid hex format', () => {
      const invalidHex = 'xyz123';
      const validHex = '1234567890abcdef'.repeat(4);
      const result = service.parseSignatureData(invalidHex, validHex, validHex, validHex);
      expect(result).toEqual({ error: 'Invalid hex format in signature components' });
    });

    it('should reject invalid lengths', () => {
      const shortHex = '123456'; // Too short
      const validHex = '1234567890abcdef'.repeat(4);
      const result = service.parseSignatureData(shortHex, validHex, validHex, validHex);
      expect(result).toEqual({ error: 'Invalid signature component lengths' });
    });
  });

  describe('verifyAndPrepareImage', () => {
    const imagePath = '/path/to/test.jpg';
    let validSignatureData: ECDSASignatureData;
    let mockBytes32: any;

    beforeEach(() => {
      vi.clearAllMocks();

      validSignatureData = {
        signatureR: '1234567890abcdef'.repeat(4),
        signatureS: 'fedcba0987654321'.repeat(4),
        publicKeyX: 'abcdef1234567890'.repeat(4),
        publicKeyY: '0987654321fedcba'.repeat(4),
      };

      mockBytes32 = { toHex: () => 'mockhash' };
      vi.mocked(Bytes32.fromHex).mockReturnValue(mockBytes32);

      vi.mocked(prepareImageVerification).mockReturnValue({
        expectedHash: mockBytes32,
        penultimateState: Array(8).fill(UInt32.from(0)),
        initialState: Array(8).fill(UInt32.from(0)),
        messageWord: UInt32.from(0),
        roundConstant: UInt32.from(0),
      } as any);
    });

    it('should accept valid ECDSA signature and return verification inputs', () => {
      const result = service.verifyAndPrepareImage(imagePath, validSignatureData);

      expect(result.isValid).toBe(true);
      expect(result.verificationInputs?.expectedHash).toEqual(mockBytes32);
      expect(result.commitment).toEqual(mockBytes32);
      expect(prepareImageVerification).toHaveBeenCalledWith(imagePath);
    });

    it('should reject invalid ECDSA signature', () => {
      // Update the mock to return false for this test
      mockEcdsa.verifySignedHash.mockReturnValueOnce({ toBoolean: () => false });

      const result = service.verifyAndPrepareImage(imagePath, validSignatureData);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('ECDSA signature does not match image hash');
    });

    it('should handle ECDSA construction errors', async () => {
      // Mock constructor to throw an error
      const { Ecdsa } = await import('authenticity-zkapp');
      const mockedEcdsa = vi.mocked(Ecdsa);
      mockedEcdsa.mockImplementationOnce(() => {
        throw new Error('Invalid ECDSA signature');
      });

      const result = service.verifyAndPrepareImage(imagePath, validSignatureData);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid ECDSA signature');
    });

    it('should handle prepareImageVerification errors', () => {
      vi.mocked(prepareImageVerification).mockImplementation(() => {
        throw new Error('Failed to read image file');
      });

      const result = service.verifyAndPrepareImage(imagePath, validSignatureData);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Failed to read image file');
    });
  });
});
