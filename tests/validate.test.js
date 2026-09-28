import { describe, it, expect } from 'vitest';
import { isValidNationalId } from '../worker/validate.js';
import { randomValidIsraeliId } from './helpers/national-id.js';

describe('isValidNationalId', () => {
  it('accepts a real checksum-valid Israeli ID', () => {
    expect(isValidNationalId('052562568')).toBe(true); // David Forshmedit's real seeded ID
  });

  it('accepts the test helper\'s generated IDs (self-consistency check)', () => {
    for (let i = 0; i < 20; i++) {
      expect(isValidNationalId(randomValidIsraeliId('3'))).toBe(true);
    }
  });

  it('rejects a made-up alphanumeric string', () => {
    expect(isValidNationalId('abcd1234')).toBe(false);
  });

  it('rejects a 9-digit number with a wrong checksum', () => {
    expect(isValidNationalId('123456789')).toBe(false);
  });

  it('rejects an empty or missing value', () => {
    expect(isValidNationalId('')).toBe(false);
    expect(isValidNationalId(undefined)).toBe(false);
    expect(isValidNationalId(null)).toBe(false);
  });

  it('rejects a value with the wrong length for either format', () => {
    expect(isValidNationalId('000000000000')).toBe(false); // 12 digits
    expect(isValidNationalId('1')).toBe(false);
  });

  it('accepts a valid 18-character Chinese ID (with checksum X)', () => {
    // A known-valid sample ID (standard GB 11643-1999 test vector).
    expect(isValidNationalId('11010519491231002X')).toBe(true);
  });

  it('rejects an 18-digit string with a broken Chinese checksum', () => {
    expect(isValidNationalId('110105194912310021')).toBe(false);
  });
});
