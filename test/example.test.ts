import { describe, it, expect } from 'vitest';

describe('Basic Test Suite', () => {
  it('should perform basic math', () => {
    expect(1 + 1).toBe(2);
  });

  it('should handle strings', () => {
    const result = 'hello' + ' ' + 'world';
    expect(result).toBe('hello world');
  });

  it('should work with arrays', () => {
    const arr = [1, 2, 3];
    expect(arr).toHaveLength(3);
    expect(arr).toContain(2);
  });
});
