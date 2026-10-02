import { describe, expect, it } from 'vitest';

import type { PaymentProvider, ProviderId } from './contract';
import { availableProviders, providerState, UNFINISHED, type PaymentEnv } from './switches';

function fake(id: ProviderId, requiredEnv: string[]): PaymentProvider {
  return {
    id,
    currency: id === 'paddle' ? 'USD' : 'UZS',
    requiredEnv,
    createCheckout: () => Promise.resolve({ kind: 'redirect', url: 'https://pay.example.test' }),
    handleWebhook: () => Promise.resolve(new Response('ok')),
  };
}

const PADDLE = fake('paddle', ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET']);
const CLICK = fake('click', ['CLICK_SECRET_KEY']);
const PAYME = fake('payme', ['PAYME_KEY']);

const FISCAL = { mxik: '10305001001000000', packageCode: '1545643', tin: '301234567', pinfl: '' };
const NO_FISCAL = { mxik: '', packageCode: ' ', tin: '', pinfl: '' };

function env(overrides: Partial<PaymentEnv> = {}): PaymentEnv {
  return {
    enabled: true,
    vars: {
      PADDLE_API_KEY: 'k',
      PADDLE_WEBHOOK_SECRET: 's',
      CLICK_SECRET_KEY: 'c',
      PAYME_KEY: 'p',
    },
    providers: [PADDLE, CLICK, PAYME],
    fiscal: FISCAL,
    unfinished: {},
    ...overrides,
  };
}

const on = { enabled: true, updatedAt: new Date(0), updatedBy: null, reason: 'go' };

describe('providerState', () => {
  it('is on only with the kill switch, the admin switch, the keys and the code', () => {
    expect(providerState('paddle', env(), on).on).toBe(true);
    expect(providerState('paddle', env({ enabled: false }), on).on).toBe(false);
    expect(providerState('paddle', env(), null).on).toBe(false);
    expect(providerState('paddle', env(), { ...on, enabled: false }).on).toBe(false);
    const noKey = providerState('paddle', env({ vars: { PADDLE_API_KEY: 'k' } }), on);
    expect(noKey.on).toBe(false);
    expect(noKey.keys).toEqual([
      { name: 'PADDLE_API_KEY', set: true },
      { name: 'PADDLE_WEBHOOK_SECRET', set: false },
    ]);
    expect(noKey.blockers).toEqual([
      'PADDLE_WEBHOOK_SECRET is not set (a Railway shared variable on the web service).',
    ]);
    const blank = providerState(
      'paddle',
      env({ vars: { PADDLE_API_KEY: ' ', PADDLE_WEBHOOK_SECRET: 's' } }),
      on,
    );
    expect(blank.on).toBe(false);
    const missing = providerState('paddle', env({ providers: [CLICK] }), on);
    expect(missing).toMatchObject({ built: false, on: false, provider: null });
    expect(missing.blockers).toEqual(['This release has no Paddle integration.']);
  });

  it('needs the fiscal receipt codes for Click and Payme, not for Paddle', () => {
    for (const id of ['click', 'payme'] as const) {
      const state = providerState(id, env({ fiscal: NO_FISCAL }), on);
      expect(state.on).toBe(false);
      expect(state.fiscal.slice(0, 2)).toEqual([
        { name: 'fiscalReceipt.mxik', set: false },
        { name: 'fiscalReceipt.packageCode', set: false },
      ]);
      expect(state.blockers.slice(0, 2)).toEqual([
        'fiscalReceipt.mxik is empty in config/business.ts.',
        'fiscalReceipt.packageCode is empty in config/business.ts.',
      ]);
      expect(providerState(id, env(), on).on).toBe(true);
    }
    const paddle = providerState('paddle', env({ fiscal: NO_FISCAL }), on);
    expect(paddle.fiscal).toEqual([]);
    expect(paddle.on).toBe(true);
  });

  it('is connected (its webhook answers) with its code and every key, whatever the switches say', () => {
    expect(providerState('paddle', env(), on).connected).toBe(true);
    expect(providerState('paddle', env({ enabled: false }), null).connected).toBe(true);
    expect(providerState('click', env({ fiscal: NO_FISCAL }), null).connected).toBe(true);
    expect(providerState('paddle', env({ vars: { PADDLE_API_KEY: 'k' } }), on).connected).toBe(
      false,
    );
    expect(providerState('paddle', env({ providers: [CLICK] }), on).connected).toBe(false);
  });

  it('keeps Click off without the seller’s TIN or PINFL, which its receipts name', () => {
    const blocked = (fiscal: typeof FISCAL) => providerState('click', env({ fiscal }), on);
    const none = blocked({ ...FISCAL, tin: '' });
    expect(none.on).toBe(false);
    expect(none.fiscal.at(-1)).toMatchObject({ name: 'fiscalReceipt.tin or .pinfl', set: false });
    expect(none.blockers).toEqual([
      'config/business.ts: fiscalReceipt.tin or fiscalReceipt.pinfl is empty.',
    ]);
    // Its webhook still answers for purchases already made (there are none while it's off).
    expect(none.connected).toBe(true);
    expect(blocked({ ...FISCAL, tin: '12345678' }).blockers).toEqual([
      'config/business.ts: fiscalReceipt.tin must be 9 digits.',
    ]);
    expect(blocked({ ...FISCAL, tin: '', pinfl: '1234567890123' }).blockers).toEqual([
      'config/business.ts: fiscalReceipt.pinfl must be 14 digits.',
    ]);
    expect(blocked({ ...FISCAL, pinfl: '31234567890123' }).blockers).toEqual([
      'config/business.ts: Set fiscalReceipt.tin or fiscalReceipt.pinfl, not both.',
    ]);
    const pinfl = blocked({ ...FISCAL, tin: '', pinfl: '31234567890123' });
    expect(pinfl.on).toBe(true);
    expect(pinfl.fiscal.at(-1)).toEqual({ name: 'fiscalReceipt.tin or .pinfl', set: true });
    // Payme sends its receipt itself, and Paddle needs none: neither asks for it.
    expect(providerState('payme', env({ fiscal: { ...FISCAL, tin: '' } }), on).on).toBe(true);
    expect(providerState('paddle', env({ fiscal: NO_FISCAL }), on).on).toBe(true);
  });

  it('has nothing unbuilt left: Click’s fiscal receipt is sent', () => {
    expect(UNFINISHED).toEqual({});
    expect(providerState('click', env({ unfinished: UNFINISHED }), on).on).toBe(true);
  });

  it('never shows a key’s value', () => {
    const state = providerState('paddle', env(), on);
    expect(JSON.stringify({ ...state, provider: null })).not.toMatch(/"k"|"s"/);
  });
});

describe('availableProviders', () => {
  it('keeps the fixed order and lets the test stub stand in for one provider', () => {
    expect(availableProviders([PAYME, PADDLE], undefined).map((p) => p.id)).toEqual([
      'paddle',
      'payme',
    ]);
    const stubbed = availableProviders([PADDLE], 'paddle');
    expect(stubbed).toHaveLength(1);
    expect(stubbed[0]).not.toBe(PADDLE);
    expect(stubbed[0]?.requiredEnv).toEqual(['PAYMENTS_STUB_KEY']);
    expect(availableProviders([], 'click').map((p) => p.id)).toEqual(['click']);
    expect(availableProviders([], undefined)).toEqual([]);
  });
});
