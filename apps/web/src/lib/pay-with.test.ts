import { describe, expect, it } from 'vitest';

import { payWithOrder } from './pay-with';

describe('payWithOrder', () => {
  const all = ['paddle', 'click', 'payme'] as const;

  it('puts Click and Payme first for Uzbekistan, Paddle first elsewhere', () => {
    expect(payWithOrder('UZ', all).map((p) => p.id)).toEqual(['click', 'payme', 'paddle']);
    expect(payWithOrder('uz', all).map((p) => p.id)).toEqual(['click', 'payme', 'paddle']);
    expect(payWithOrder('DE', all).map((p) => p.id)).toEqual(['paddle', 'click', 'payme']);
    expect(payWithOrder(null, all).map((p) => p.id)).toEqual(['paddle', 'click', 'payme']);
    expect(payWithOrder('XX', all).map((p) => p.id)).toEqual(['paddle', 'click', 'payme']);
  });

  it('offers only the providers that are on, each in its own currency', () => {
    expect(payWithOrder('UZ', ['paddle'])).toEqual([
      expect.objectContaining({ id: 'paddle', name: 'Paddle', currency: 'USD' }),
    ]);
    expect(payWithOrder('US', ['payme', 'click']).map((p) => [p.id, p.currency])).toEqual([
      ['click', 'UZS'],
      ['payme', 'UZS'],
    ]);
    expect(payWithOrder('UZ', [])).toEqual([]);
  });
});
