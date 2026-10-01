import { describe, expect, it, vi } from 'vitest';

import { formatUserCode, newUserCode, normalizeUserCode } from './device';

vi.mock('./db', () => ({ db: () => ({}) }));

describe('connect codes', () => {
  it('are 8 consonants, never a vowel, so never a word', () => {
    const codes = Array.from({ length: 300 }, newUserCode);
    for (const code of codes) expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/);
    expect(new Set(codes).size).toBe(300);
    expect(new Set(codes.join('')).size).toBe(20);
  });

  it('are shown in two halves and read back however they were typed', () => {
    expect(formatUserCode('BCDFGHJK')).toBe('BCDF-GHJK');
    for (const typed of ['BCDF-GHJK', 'bcdf-ghjk', ' bcdf ghjk ', 'BCDFGHJK']) {
      expect(normalizeUserCode(typed)).toBe('BCDFGHJK');
    }
  });

  it('refuse what can never be a code', () => {
    for (const typed of ['', 'BCDF-GHJ', 'BCDF-GHJKL', 'ABCD-EFGH', 'BCDF_GHJK', 'BCDF-GHJ1']) {
      expect(normalizeUserCode(typed)).toBeNull();
    }
  });
});
