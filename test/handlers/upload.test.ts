import { describe, it, expect, vi, beforeAll } from 'vitest';
import { UploadHandler } from '../../src/handlers/upload.handler.js';
import { ImageAuthenticityService } from '../../src/services/image/verification.service.js';
import fs from 'fs';

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
  },
}));

// Mock the authenticity-zkapp to avoid ZK circuit loading
vi.mock('authenticity-zkapp', () => ({
  hashImageOffCircuit: vi.fn(),
  prepareImageVerification: vi.fn(),
  Secp256r1: vi.fn(),
  Ecdsa: vi.fn(),
  Bytes32: { fromHex: vi.fn() },
}));

describe('UploadHandler', () => {
  let validSignatureR: string;
  let validSignatureS: string;
  let validPublicKeyX: string;
  let validPublicKeyY: string;

  beforeAll(() => {
    // Valid 64-character hex strings
    validSignatureR = '1234567890abcdef'.repeat(4);
    validSignatureS = 'fedcba0987654321'.repeat(4);
    validPublicKeyX = 'abcdef1234567890'.repeat(4);
    validPublicKeyY = '0987654321fedcba'.repeat(4);
  });

  describe('validateUploadRequest', () => {
    const verificationService = new ImageAuthenticityService();

    const handler: any = new UploadHandler(
      verificationService,
      null as any,
      null as any,
      null as any
    );
    const mockFile: any = { path: '/tmp/test.jpg' };

    it('should reject when image is missing', () => {
      expect(() => {
        handler.validateUploadRequest(
          undefined,
          validSignatureR,
          validSignatureS,
          validPublicKeyX,
          validPublicKeyY
        );
      }).toThrow('No image file provided');
    });

    it('should reject when signature components are missing', () => {
      fs.readFileSync = vi.fn().mockReturnValue(Buffer.from('test data'));

      expect(() => {
        handler.validateUploadRequest(
          mockFile,
          validSignatureR,
          undefined,
          validPublicKeyX,
          validPublicKeyY
        );
      }).toThrow('Missing required signature components');
    });

    it('should reject empty image data', () => {
      fs.readFileSync = vi.fn().mockReturnValue(Buffer.from(''));
      expect(() => {
        handler.validateUploadRequest(
          mockFile,
          validSignatureR,
          validSignatureS,
          validPublicKeyX,
          validPublicKeyY
        );
      }).toThrow('Image buffer is empty');
    });

    it('should reject invalid signature format', () => {
      fs.readFileSync = vi.fn().mockReturnValue(Buffer.from('test data'));

      expect(() => {
        handler.validateUploadRequest(
          mockFile,
          'invalid-sig',
          validSignatureS,
          validPublicKeyX,
          validPublicKeyY
        );
      }).toThrow('Invalid hex format in signature components');
    });

    it('should accept valid ECDSA submission data', () => {
      const testBuffer = Buffer.from('test image data');
      fs.readFileSync = vi.fn().mockReturnValue(testBuffer);

      const result = handler.validateUploadRequest(
        mockFile,
        validSignatureR,
        validSignatureS,
        validPublicKeyX,
        validPublicKeyY
      );

      expect(result.imageBuffer).toEqual(testBuffer);
      expect(result.signatureData).toEqual({
        signatureR: validSignatureR,
        signatureS: validSignatureS,
        publicKeyX: validPublicKeyX,
        publicKeyY: validPublicKeyY,
      });
    });
  });
});
