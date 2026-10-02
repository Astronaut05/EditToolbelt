import { describe, expect, it } from 'vitest';

import { payme, PAYME_ERRORS, PAYME_MESSAGES } from './payme';
import { ProviderConfigError } from './shared';
import { testContext } from './testing/context';
import { MemoryPurchaseStore } from './testing/memory-store';

const ENV = {
  PAYME_MERCHANT_ID: '587f72c72cac0d162c722ae2',
  PAYME_KEY: 'payme-test-key',
  PAYME_TEST: 'true',
};

describe('Payme checkout', () => {
  it('sends the buyer to Payme’s checkout with base64(m;ac.order_id;a;c), the amount in tiyin', async () => {
    const store = new MemoryPurchaseStore();
    const purchase = store.seed({ provider: 'payme', id: '197', amountMinor: 500 });
    const checkout = await payme.createCheckout(
      purchase,
      { email: null },
      testContext({ store, env: { ...ENV, PAYME_TEST: 'false' } }),
    );
    // Vector computed outside this code.
    expect(checkout).toEqual({
      kind: 'redirect',
      url: 'https://checkout.paycom.uz/bT01ODdmNzJjNzJjYWMwZDE2MmM3MjJhZTI7YWMub3JkZXJfaWQ9MTk3O2E9NTAwO2M9aHR0cHM6Ly9ldGIudGVzdC9jcmVkaXRzL3JldHVybj9wdXJjaGFzZT0xOTc=',
    });
  });

  it('uses the test checkout while PAYME_TEST is true', async () => {
    const store = new MemoryPurchaseStore();
    const purchase = store.seed({ provider: 'payme', packId: 'creator' });
    const checkout = await payme.createCheckout(
      purchase,
      { email: null },
      testContext({ store, env: ENV }),
    );
    if (checkout.kind !== 'redirect') throw new Error('expected a redirect');
    const url = new URL(checkout.url);
    expect(url.origin).toBe('https://checkout.test.paycom.uz');
    const decoded = Buffer.from(url.pathname.slice(1), 'base64').toString('utf8');
    expect(decoded).toBe(
      `m=${ENV.PAYME_MERCHANT_ID};ac.order_id=${purchase.id};a=18900000;c=https://etb.test/credits/return?purchase=${purchase.id}`,
    );
  });

  it('refuses without its env, with an unclear PAYME_TEST, or for a purchase it can’t take', async () => {
    const store = new MemoryPurchaseStore();
    const purchase = store.seed({ provider: 'payme' });
    await expect(
      payme.createCheckout(
        purchase,
        { email: null },
        testContext({ store, env: { ...ENV, PAYME_KEY: '' } }),
      ),
    ).rejects.toThrow(ProviderConfigError);
    await expect(
      payme.createCheckout(
        purchase,
        { email: null },
        testContext({ store, env: { ...ENV, PAYME_TEST: 'yes' } }),
      ),
    ).rejects.toThrow(/PAYME_TEST/);
    const ctx = testContext({ store, env: ENV });
    await expect(
      payme.createCheckout(store.seed({ provider: 'click' }), { email: null }, ctx),
    ).rejects.toThrow();
    await expect(
      payme.createCheckout(store.seed({ provider: 'payme', id: 'a;b' }), { email: null }, ctx),
    ).rejects.toThrow(/;/);
  });

  it('declares the env it needs', () => {
    expect(payme.requiredEnv).toEqual(['PAYME_MERCHANT_ID', 'PAYME_KEY', 'PAYME_TEST']);
    expect(payme.currency).toBe('UZS');
  });
});

describe('Payme errors', () => {
  it('have a message in Russian, Uzbek and English for every code', () => {
    for (const code of Object.values(PAYME_ERRORS)) {
      const message = PAYME_MESSAGES[code];
      expect(message.ru.length * message.uz.length * message.en.length).toBeGreaterThan(0);
    }
  });

  it('keep order errors inside Payme’s -31050…-31099 range', () => {
    for (const code of [
      PAYME_ERRORS.ORDER_NOT_FOUND,
      PAYME_ERRORS.ORDER_NOT_PAYABLE,
      PAYME_ERRORS.ORDER_BUSY,
    ]) {
      expect(code).toBeLessThanOrEqual(-31050);
      expect(code).toBeGreaterThanOrEqual(-31099);
    }
  });

  it('answer 503 while the key is unset', async () => {
    const response = await payme.handleWebhook(
      new Request('http://localhost/api/webhooks/payme', { method: 'POST', body: '{}' }),
      testContext({ store: new MemoryPurchaseStore(), env: {} }),
    );
    expect(response.status).toBe(503);
  });
});
