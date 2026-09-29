import { describe, expect, it } from 'vitest';

import { MIN_PACK_PRICE_USD, creditNetUsd, packNetUsdPerCredit, packs } from './business';

describe('credit packs', () => {
  it('never go below the minimum pack price', () => {
    for (const pack of packs) expect(pack.priceUsd).toBeGreaterThanOrEqual(MIN_PACK_PRICE_USD);
  });

  it('get cheaper per credit as they get bigger', () => {
    const sorted = [...packs].sort((a, b) => a.credits - b.credits);
    const perCredit = sorted.map((pack) => pack.priceUsd / pack.credits);
    for (let i = 1; i < perCredit.length; i++) {
      expect(perCredit[i]).toBeLessThan(perCredit[i - 1] ?? Infinity);
    }
  });

  it('have unique ids', () => {
    expect(new Set(packs.map((pack) => pack.id)).size).toBe(packs.length);
  });
});

describe('creditNetUsd', () => {
  // Reference values from docs/05 → Pricing a job.
  it.each([
    ['starter', 0.0171],
    ['creator', 0.0161],
    ['studio', 0.0154],
  ])('%s pack nets ≈ $%s per credit', (id, expected) => {
    const pack = packs.find((candidate) => candidate.id === id);
    expect(pack).toBeDefined();
    if (pack) expect(packNetUsdPerCredit(pack)).toBeCloseTo(expected, 4);
  });

  it('is taken from the pack that is worst for us, not the list price', () => {
    expect(creditNetUsd).toBeCloseTo(0.0154, 4);
    expect(creditNetUsd).toBe(Math.min(...packs.map(packNetUsdPerCredit)));
  });
});
