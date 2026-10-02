import { describe, expect, it } from 'vitest';

import { MemoryPurchaseStore } from './testing/memory-store';
import { testContext } from './testing/context';
import {
  parseSums,
  ProviderConfigError,
  readBody,
  readEnv,
  returnUrl,
  safeEqual,
  sums,
} from './shared';

describe('provider helpers', () => {
  it('write tiyin as sums with two decimals', () => {
    expect(sums(6_300_000)).toBe('63000.00');
    expect(sums(6_300_050)).toBe('63000.50');
    expect(sums(5)).toBe('0.05');
  });

  it('read sums back exactly, refusing fractions of a tiyin and anything odd', () => {
    expect(parseSums('63000')).toBe(6_300_000);
    expect(parseSums('63000.0')).toBe(6_300_000);
    expect(parseSums('63000.00')).toBe(6_300_000);
    expect(parseSums('63000.000')).toBe(6_300_000);
    expect(parseSums('63000.5')).toBe(6_300_050);
    expect(parseSums('63000.001')).toBeNull();
    for (const bad of ['', '-1', '1e5', '63 000', '63,000', 'abc', '.5'])
      expect(parseSums(bad)).toBeNull();
  });

  it('compare secrets whatever their lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('name missing env vars, never values', () => {
    const ctx = testContext({
      store: new MemoryPurchaseStore(),
      env: { A: 'secret-value', B: '  ', C: undefined },
    });
    expect(readEnv(ctx, 'paddle', ['A'])).toEqual({ A: 'secret-value' });
    try {
      readEnv(ctx, 'paddle', ['A', 'B', 'C']);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderConfigError);
      expect(String(error)).toContain('B, C not set');
      expect(String(error)).not.toContain('secret-value');
    }
  });

  it('build return URLs on SITE_URL', () => {
    const ctx = testContext({
      store: new MemoryPurchaseStore(),
      env: {},
      siteUrl: 'https://etb.test/',
    });
    expect(returnUrl(ctx, 'a b')).toBe('https://etb.test/credits/return?purchase=a%20b');
  });

  it('refuse bodies over the limit', async () => {
    const big = new Request('http://localhost/x', { method: 'POST', body: 'x'.repeat(20) });
    expect(await readBody(big, 10)).toBeNull();
    const small = new Request('http://localhost/x', { method: 'POST', body: 'hello' });
    expect((await readBody(small, 10))?.toString()).toBe('hello');
  });
});
