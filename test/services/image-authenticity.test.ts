import { describe, it, expect } from 'vitest';
import { ImageAuthenticityService } from '../../src/services/image/verification.service.js';
import { createHash } from 'crypto';

describe('ImageAuthenticityService', () => {
  const service = new ImageAuthenticityService();

  describe('hashImage', () => {
    it('should compute correct SHA256 hash', () => {
      const testBuffer = Buffer.from('test image data');
      const expectedHash = createHash('sha256').update(testBuffer).digest('hex');

      expect(service.hashImage(testBuffer)).toBe(expectedHash);
    });
  });
});
