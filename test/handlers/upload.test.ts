import { describe, it, expect, vi, beforeAll } from 'vitest';
import { UploadHandler } from '../../src/handlers/upload.handler.js';
import { PrivateKey, Signature, Field } from 'o1js';
import fs from 'fs';

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
  },
}));

describe('UploadHandler', () => {
  let validPublicKey: string;
  let validSignature: string;

  beforeAll(() => {
    const privateKey = PrivateKey.random();
    validPublicKey = privateKey.toPublicKey().toBase58();
    validSignature = Signature.create(privateKey, [Field(123456)]).toBase58();
  });

  describe('validateUploadRequest', () => {
    const handler: any = new UploadHandler(null as any, null as any, null as any, null as any);
    const mockFile: any = { path: '/tmp/test.jpg' };

    it('should reject when image is missing', () => {
      expect(() => {
        handler.validateUploadRequest(undefined, validPublicKey, validSignature);
      }).toThrow('No image file provided');
    });

    it('should reject when signature is missing', () => {
      expect(() => {
        handler.validateUploadRequest(mockFile, validPublicKey, undefined);
      }).toThrow('Signature is required');
    });

    it('should reject when publicKey is missing', () => {
      expect(() => {
        handler.validateUploadRequest(mockFile, undefined, validSignature);
      }).toThrow('Public key is required');
    });

    it('should reject empty image data', () => {
      fs.readFileSync = vi.fn().mockReturnValue(Buffer.from(''));
      expect(() => {
        handler.validateUploadRequest(mockFile, validPublicKey, validSignature);
      }).toThrow('Image buffer is empty');
    });

    it('should reject invalid signature format', () => {
      fs.readFileSync = vi.fn().mockReturnValue(Buffer.from('test data'));
      expect(() => {
        handler.validateUploadRequest(mockFile, validPublicKey, 'invalid-sig');
      }).toThrow('Invalid signature format');
    });

    it('should reject invalid publicKey format', () => {
      fs.readFileSync = vi.fn().mockReturnValue(Buffer.from('test data'));
      expect(() => {
        handler.validateUploadRequest(mockFile, 'invalid-key', validSignature);
      }).toThrow('Invalid public key format');
    });

    it('should accept valid submission data', () => {
      const testBuffer = Buffer.from('test image data');
      fs.readFileSync = vi.fn().mockReturnValue(testBuffer);

      const result = handler.validateUploadRequest(mockFile, validPublicKey, validSignature);

      expect(result).toEqual(testBuffer);
    });
  });
});
