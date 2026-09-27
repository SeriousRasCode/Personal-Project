import { describe, expect, it } from 'vitest';
import { isValidPhone, normalizePhone } from './phone.util.js';

describe('phone utilities', () => {
  it('normalizes formatted and international-prefixed numbers', () => {
    expect(normalizePhone('+251 (900) 000-000')).toBe('+251900000000');
    expect(normalizePhone('00251 900 000 000')).toBe('+251900000000');
  });

  it('rejects numbers outside the E.164 range', () => {
    expect(isValidPhone('+2519000000')).toBe(true);
    expect(isValidPhone('251900000000')).toBe(false);
    expect(isValidPhone('+0251900000000')).toBe(false);
    expect(() => normalizePhone('not-a-phone')).toThrow();
  });
});
