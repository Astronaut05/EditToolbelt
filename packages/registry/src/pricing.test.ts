import { describe, expect, it } from 'vitest';

import { priceOf } from './pricing';

describe('priceOf', () => {
  it('prices per started minute, with a minimum', () => {
    const rule = { kind: 'perMinute', credits: 1, minCredits: 2 } as const;
    expect(priceOf(rule, { durationMs: 30_000 })).toBe(2);
    expect(priceOf(rule, { durationMs: 10.5 * 60_000 })).toBe(11);
    expect(priceOf(rule, { durationMs: 3 * 60_000 })).toBe(3);
    expect(priceOf(rule, {})).toBe(2);
  });

  it('prices flat, free and per megapixel', () => {
    expect(priceOf({ kind: 'flat', credits: 2 }, {})).toBe(2);
    expect(priceOf({ kind: 'free' }, { durationMs: 1e9 })).toBe(0);
    const mp = { kind: 'perMegapixel', credits: 0.25, minCredits: 2 } as const;
    expect(priceOf(mp, { megapixels: 16 })).toBe(4);
    expect(priceOf(mp, { megapixels: 1 })).toBe(2);
  });
});
