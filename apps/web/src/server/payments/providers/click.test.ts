import { describe, expect, it } from 'vitest';

import { click, CLICK_ERROR_NOTES, CLICK_ERRORS, clickSignature } from './click';
import { ProviderConfigError } from './shared';
import { clickSignTime } from './sim/click';
import { testContext } from './testing/context';
import { MemoryPurchaseStore } from './testing/memory-store';

const ENV = {
  CLICK_SERVICE_ID: '12345',
  CLICK_MERCHANT_ID: '67890',
  CLICK_MERCHANT_USER_ID: '24680',
  CLICK_SECRET_KEY: 's3cr3t',
  CLICK_MERCHANT_API_URL: 'https://merchant.click.test/v2/merchant/',
};

describe('Click checkout', () => {
  it('sends the buyer to Click’s payment page with the amount in sums', async () => {
    const store = new MemoryPurchaseStore();
    const purchase = store.seed({ provider: 'click', packId: 'starter' });
    const checkout = await click.createCheckout(
      purchase,
      { email: null },
      testContext({ store, env: ENV }),
    );
    if (checkout.kind !== 'redirect') throw new Error('expected a redirect');
    const url = new URL(checkout.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://my.click.uz/services/pay');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      service_id: '12345',
      merchant_id: '67890',
      merchant_user_id: '24680',
      amount: '63000.00',
      transaction_param: purchase.id,
      return_url: `https://etb.test/credits/return?purchase=${purchase.id}`,
    });
  });

  it('refuses without its env, or for a purchase it can’t take', async () => {
    const store = new MemoryPurchaseStore();
    const ctx = testContext({ store, env: { ...ENV, CLICK_SECRET_KEY: undefined } });
    await expect(
      click.createCheckout(store.seed({ provider: 'click' }), { email: null }, ctx),
    ).rejects.toThrow(ProviderConfigError);
    const ready = testContext({ store, env: ENV });
    await expect(
      click.createCheckout(store.seed({ provider: 'payme' }), { email: null }, ready),
    ).rejects.toThrow();
    await expect(
      click.createCheckout(
        store.seed({ provider: 'click', status: 'cancelled' }),
        { email: null },
        ready,
      ),
    ).rejects.toThrow();
  });

  it('declares the env it needs', () => {
    expect(click.requiredEnv).toEqual([
      'CLICK_SERVICE_ID',
      'CLICK_MERCHANT_ID',
      'CLICK_MERCHANT_USER_ID',
      'CLICK_SECRET_KEY',
      'CLICK_MERCHANT_API_URL',
    ]);
    expect(click.currency).toBe('UZS');
  });
});

describe('Click signatures', () => {
  // Vectors computed outside this code: md5 of the documented concatenation.
  it('sign Prepare as md5(click_trans_id service_id SECRET merchant_trans_id amount action sign_time)', () => {
    const fields = {
      click_trans_id: '2154536363',
      service_id: '12345',
      merchant_trans_id: 'order-1',
      amount: '63000.00',
      action: '0',
      sign_time: '2026-10-02 14:00:00',
    };
    expect(clickSignature(fields, 's3cr3t')).toBe('f1cce82ddac253f4dfa339df05de9efb');
    // merchant_prepare_id isn't part of a Prepare signature.
    expect(clickSignature({ ...fields, merchant_prepare_id: '777' }, 's3cr3t')).toBe(
      'f1cce82ddac253f4dfa339df05de9efb',
    );
  });

  it('sign Complete with merchant_prepare_id after merchant_trans_id', () => {
    expect(
      clickSignature(
        {
          click_trans_id: '2154536363',
          service_id: '12345',
          merchant_trans_id: 'order-1',
          merchant_prepare_id: '777',
          amount: '63000.00',
          action: '1',
          sign_time: '2026-10-02 14:00:05',
        },
        's3cr3t',
      ),
    ).toBe('bd58ecabb13862844014b97acabc1bdb');
  });

  it('use Tashkent time for sign_time in the simulator', () => {
    expect(clickSignTime(new Date(Date.UTC(2026, 9, 2, 9, 0, 0)))).toBe('2026-10-02 14:00:00');
  });

  it('have Click’s notes for every code', () => {
    expect(Object.values(CLICK_ERRORS).sort((a, b) => a - b)).toEqual([
      -9, -8, -7, -6, -5, -4, -3, -2, -1, 0,
    ]);
    expect(CLICK_ERROR_NOTES[-1]).toBe('SIGN CHECK FAILED!');
    expect(CLICK_ERROR_NOTES[0]).toBe('Success');
  });
});

describe('Click webhook setup', () => {
  it('answers 503 while its keys are unset', async () => {
    const store = new MemoryPurchaseStore();
    const response = await click.handleWebhook(
      new Request('http://localhost/api/webhooks/click', { method: 'POST', body: 'a=1' }),
      testContext({ store, env: {} }),
    );
    expect(response.status).toBe(503);
  });
});
