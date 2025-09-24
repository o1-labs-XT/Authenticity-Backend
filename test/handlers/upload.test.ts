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
      const result = handler.validateUploadRequest(undefined, validPublicKey, validSignature);

      expect(result.isValid).toBe(false);
      expect(result.error?.field).toBe('image');
    });

    it('should reject when signature is missing', () => {
      const result = handler.validateUploadRequest(mockFile, validPublicKey, undefined);

      expect(result.isValid).toBe(false);
      expect(result.error?.field).toBe('signature');
    });

    it('should reject when publicKey is missing', () => {
      const result = handler.validateUploadRequest(mockFile, undefined, validSignature);

      expect(result.isValid).toBe(false);
      expect(result.error?.field).toBe('publicKey');
    });

    it('should reject empty image data', () => {
      fs.readFileSync = vi.fn().mockReturnValue(Buffer.from(''));
      const result = handler.validateUploadRequest(mockFile, validPublicKey, validSignature);

      expect(result.isValid).toBe(false);
      expect(result.error?.field).toBe('image');
    });

    it('should reject invalid signature format', () => {
      fs.readFileSync = vi.fn().mockReturnValue(Buffer.from('test data'));
      const result = handler.validateUploadRequest(mockFile, validPublicKey, 'invalid-sig');

      expect(result.isValid).toBe(false);
      expect(result.error?.field).toBe('signature');
    });

    it('should reject invalid publicKey format', () => {
      fs.readFileSync = vi.fn().mockReturnValue(Buffer.from('test data'));
      const result = handler.validateUploadRequest(mockFile, 'invalid-key', validSignature);

      expect(result.isValid).toBe(false);
      expect(result.error?.field).toBe('publicKey');
    });

    it('should accept valid submission data', () => {
      const testBuffer = Buffer.from('test image data');
      fs.readFileSync = vi.fn().mockReturnValue(testBuffer);

      const result = handler.validateUploadRequest(mockFile, validPublicKey, validSignature);

      expect(result.isValid).toBe(true);
      expect(result.imageBuffer).toEqual(testBuffer);
    });
  });
});
