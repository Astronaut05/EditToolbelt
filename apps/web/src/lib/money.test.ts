import { packs } from '@etb/config/business';
import { describe, expect, it } from 'vitest';

import { formatMoney, packAmountMinor, packById, perCredit } from './money';

describe('pack prices in minor units', () => {
  it('are cents for USD and tiyin for UZS, from config', () => {
    const creator = packById('creator');
    expect(creator).toBeDefined();
    if (!creator) return;
    expect(packAmountMinor(creator, 'USD')).toBe(1500);
    expect(packAmountMinor(creator, 'UZS')).toBe(18_900_000);
    for (const pack of packs) {
      expect(Number.isInteger(packAmountMinor(pack, 'USD'))).toBe(true);
      expect(packAmountMinor(pack, 'UZS')).toBe(pack.priceUzs * 100);
    }
    expect(packById('nope')).toBeUndefined();
  });
});

describe('formatMoney', () => {
  it('writes dollars with cents and sums with the currency code', () => {
    expect(formatMoney(1500, 'USD')).toBe('$15.00');
    expect(formatMoney(499, 'USD')).toBe('$4.99');
    expect(formatMoney(18_900_000, 'UZS')).toBe('189,000 UZS');
    expect(formatMoney(150, 'UZS')).toBe('1.5 UZS');
  });

  it('gives the price of one credit', () => {
    const starter = packById('starter');
    if (!starter) throw new Error('no starter pack');
    expect(perCredit(starter, 'USD')).toBe('2.5¢ a credit');
    expect(perCredit(starter, 'UZS')).toBe('315 UZS a credit');
  });
});
