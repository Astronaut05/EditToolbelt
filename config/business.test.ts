import { describe, expect, it } from 'vitest';

import {
  MIN_PACK_PRICE_USD,
  creditNetUsd,
  disposableEmailDomains,
  fiscalReceipt,
  packNetUsdPerCredit,
  packs,
  sellerTaxId,
} from './business';

describe('credit packs', () => {
  it('never go below the minimum pack price', () => {
    for (const pack of packs) expect(pack.priceUsd).toBeGreaterThanOrEqual(MIN_PACK_PRICE_USD);
  });

  it.each(['priceUsd', 'priceUzs'] as const)(
    'get cheaper per credit as they get bigger (%s)',
    (price) => {
      const sorted = [...packs].sort((a, b) => a.credits - b.credits);
      const perCredit = sorted.map((pack) => pack[price] / pack.credits);
      for (let i = 1; i < perCredit.length; i++) {
        expect(perCredit[i]).toBeLessThan(perCredit[i - 1] ?? Infinity);
      }
    },
  );

  it('are priced in whole sums in UZS', () => {
    for (const pack of packs) expect(Number.isInteger(pack.priceUzs)).toBe(true);
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

describe('disposableEmailDomains', () => {
  it('are bare, lowercase domains, listed once', () => {
    for (const domain of disposableEmailDomains) {
      expect(domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }
    expect(new Set(disposableEmailDomains).size).toBe(disposableEmailDomains.length);
  });
});

describe('fiscalReceipt', () => {
  it('has a whole VAT percent from 0 to 100', () => {
    expect(Number.isInteger(fiscalReceipt.vatPercent)).toBe(true);
    expect(fiscalReceipt.vatPercent).toBeGreaterThanOrEqual(0);
    expect(fiscalReceipt.vatPercent).toBeLessThanOrEqual(100);
  });

  it('names the seller well, once it names them at all', () => {
    // Empty until Astro has the values; a typo in either fails here, not at the tax service.
    if (fiscalReceipt.tin.trim() || fiscalReceipt.pinfl.trim())
      expect(sellerTaxId(fiscalReceipt)).toMatchObject({ ok: true });
  });
});

describe('sellerTaxId', () => {
  it('takes a 9-digit TIN or a 14-digit PINFL', () => {
    expect(sellerTaxId({ tin: '301234567', pinfl: '' })).toEqual({
      ok: true,
      id: { TIN: '301234567' },
    });
    expect(sellerTaxId({ tin: ' ', pinfl: ' 31234567890123 ' })).toEqual({
      ok: true,
      id: { PINFL: '31234567890123' },
    });
  });

  it('says what’s wrong otherwise', () => {
    expect(sellerTaxId({ tin: '', pinfl: '' })).toEqual({
      ok: false,
      problem: 'fiscalReceipt.tin or fiscalReceipt.pinfl is empty.',
    });
    expect(sellerTaxId({ tin: '301234567', pinfl: '31234567890123' })).toEqual({
      ok: false,
      problem: 'Set fiscalReceipt.tin or fiscalReceipt.pinfl, not both.',
    });
    for (const tin of ['30123456', '3012345678', '30123456a', '301 234 567'])
      expect(sellerTaxId({ tin, pinfl: '' })).toEqual({
        ok: false,
        problem: 'fiscalReceipt.tin must be 9 digits.',
      });
    for (const pinfl of ['3123456789012', '312345678901234', '3123456789012x'])
      expect(sellerTaxId({ tin: '', pinfl })).toEqual({
        ok: false,
        problem: 'fiscalReceipt.pinfl must be 14 digits.',
      });
  });
});
