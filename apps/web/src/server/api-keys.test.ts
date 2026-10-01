import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { hashKey, KEY_PREFIX, keyPrefix, looksLikeKey, newKey } from './api-keys';

vi.mock('./db', () => ({ db: () => ({}) }));

describe('API keys', () => {
  it('are etb_live_ and 32 letters and digits, different every time', () => {
    const keys = new Set(Array.from({ length: 200 }, newKey));
    expect(keys.size).toBe(200);
    for (const key of keys) {
      expect(key).toMatch(/^etb_live_[0-9A-Za-z]{32}$/);
      expect(looksLikeKey(key)).toBe(true);
    }
  });

  it('use the whole alphabet', () => {
    const seen = new Set(Array.from({ length: 200 }, newKey).join('').slice(KEY_PREFIX.length));
    expect(seen.size).toBeGreaterThan(55);
  });

  it('are kept as a SHA-256 and shown by their first 8 characters', () => {
    const key = `${KEY_PREFIX}${'a'.repeat(32)}`;
    expect(hashKey(key)).toBe(createHash('sha256').update(key).digest('hex'));
    expect(keyPrefix(key)).toBe('etb_live_aaaaaaaa');
  });

  it('refuse anything else before a lookup', () => {
    for (const value of [
      '',
      'etb_live_',
      `etb_test_${'a'.repeat(32)}`,
      `${KEY_PREFIX}${'a'.repeat(31)}`,
      `${KEY_PREFIX}${'a'.repeat(33)}`,
      `${KEY_PREFIX}${'a'.repeat(31)}-`,
      ` ${KEY_PREFIX}${'a'.repeat(32)}`,
    ]) {
      expect(looksLikeKey(value)).toBe(false);
    }
  });
});
