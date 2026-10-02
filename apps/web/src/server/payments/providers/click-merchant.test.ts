/**
 * Click's Merchant API client: the Auth header, the receipt body and its
 * VAT, and the call itself against a fake fetch (Click's hosts can't be
 * reached from the build container).
 */
import type { FiscalReceiptConfig } from '@etb/config/business';
import { describe, expect, it } from 'vitest';

import {
  clickAuthHeader,
  receiptBody,
  submitItemsUrl,
  submitReceipt,
  vatIncluded,
  type ClickReceiptBody,
} from './click-merchant';

const FISCAL: FiscalReceiptConfig = {
  mxik: '10305001001000000',
  packageCode: '1545643',
  vatPercent: 12,
  tin: '301234567',
  pinfl: '',
};

const STARTER = { credits: 200, amountMinor: 6_300_000, currency: 'UZS' };

describe('clickAuthHeader', () => {
  // Vector computed outside this code: `printf '1712345678SECRET123' | sha1sum`,
  // the worked example of merchant_user_id:sha1(timestamp + secret_key):timestamp.
  it('is merchant_user_id:sha1(timestamp + secret_key):timestamp, in Unix seconds', () => {
    expect(clickAuthHeader('3333', 'SECRET123', new Date(1_712_345_678_000))).toBe(
      '3333:4d3f62489dbc19114297581bcfa0d906f84df0cd:1712345678',
    );
    // Milliseconds are dropped, not rounded.
    expect(clickAuthHeader('3333', 'SECRET123', new Date(1_712_345_678_999))).toBe(
      '3333:4d3f62489dbc19114297581bcfa0d906f84df0cd:1712345678',
    );
  });
});

describe('vatIncluded', () => {
  it('takes the VAT out of a tax-inclusive price, in whole tiyin', () => {
    expect(vatIncluded(6_300_000, 12)).toBe(675_000); // 63,000 sum: 6,750 sum of VAT
    expect(vatIncluded(18_900_000, 12)).toBe(2_025_000);
    expect(vatIncluded(49_900_000, 12)).toBe(5_346_429); // 5,346,428.57 rounded
    expect(vatIncluded(6_300_000, 15)).toBe(821_739); // 821,739.13 rounded
    expect(vatIncluded(6_300_000, 0)).toBe(0);
  });
});

describe('receiptBody', () => {
  it('is one line for the pack, in tiyin, naming the seller by TIN', () => {
    expect(
      receiptBody({ serviceId: '12345', paymentId: '7154536363', sale: STARTER, fiscal: FISCAL }),
    ).toEqual({
      ok: true,
      body: {
        service_id: 12345,
        payment_id: 7154536363,
        items: [
          {
            Name: 'EditToolbelt credits: 200',
            SPIC: '10305001001000000',
            PackageCode: '1545643',
            GoodPrice: 6_300_000,
            Price: 6_300_000,
            Amount: 1,
            VAT: 675_000,
            VATPercent: 12,
            CommissionInfo: { TIN: '301234567' },
          },
        ],
        received_ecash: 6_300_000,
        received_cash: 0,
        received_card: 0,
      },
    });
  });

  it('names a sole trader by PINFL, and has no VAT for a seller who pays none', () => {
    const built = receiptBody({
      serviceId: '12345',
      paymentId: '1',
      sale: { credits: 2000, amountMinor: 49_900_000, currency: 'UZS' },
      fiscal: { ...FISCAL, vatPercent: 0, tin: '', pinfl: '31234567890123' },
    });
    if (!built.ok) throw new Error(built.problem);
    expect(built.body.items[0]).toMatchObject({
      Name: 'EditToolbelt credits: 2000',
      Price: 49_900_000,
      VAT: 0,
      VATPercent: 0,
      CommissionInfo: { PINFL: '31234567890123' },
    });
    expect(built.body.received_ecash).toBe(49_900_000);
  });

  it('says everything that’s missing, and builds nothing', () => {
    expect(
      receiptBody({
        serviceId: 'abc',
        paymentId: '-4',
        sale: { credits: 200, amountMinor: 500, currency: 'USD' },
        fiscal: { mxik: ' ', packageCode: '', vatPercent: 12.5, tin: '', pinfl: '' },
      }),
    ).toEqual({
      ok: false,
      problem:
        'fiscalReceipt.mxik is empty. fiscalReceipt.packageCode is empty. ' +
        'fiscalReceipt.tin or fiscalReceipt.pinfl is empty. ' +
        'fiscalReceipt.vatPercent must be a whole number from 0 to 100. ' +
        'A Click receipt is in UZS. CLICK_SERVICE_ID is not a number. ' +
        'Click’s payment id is not a number.',
    });
  });
});

describe('submitItemsUrl', () => {
  it('puts the endpoint under the base URL, with or without its last slash', () => {
    expect(submitItemsUrl('https://merchant.click.test/v2/merchant/')).toBe(
      'https://merchant.click.test/v2/merchant/payment/ofd_data/submit_items',
    );
    expect(submitItemsUrl(' https://merchant.click.test/v2/merchant ')).toBe(
      'https://merchant.click.test/v2/merchant/payment/ofd_data/submit_items',
    );
  });
});

describe('submitReceipt', () => {
  const ENV = {
    CLICK_MERCHANT_USER_ID: '3333',
    CLICK_SECRET_KEY: 'SECRET123',
    CLICK_MERCHANT_API_URL: 'https://merchant.click.test/v2/merchant/',
  };
  const built = receiptBody({ serviceId: '12345', paymentId: '99', sale: STARTER, fiscal: FISCAL });
  if (!built.ok) throw new Error(built.problem);
  const body: ClickReceiptBody = built.body;
  const now = () => new Date(1_712_345_678_000);

  function fake(answer: () => Promise<Response>) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    return {
      calls,
      fetch: (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return answer();
      },
    };
  }

  it('posts the body as JSON with the Auth header, and takes error_code 0 as accepted', async () => {
    const click = fake(() =>
      Promise.resolve(Response.json({ error_code: 0, error_note: 'Success' })),
    );
    expect(await submitReceipt({ env: ENV, fetch: click.fetch, now }, body)).toEqual({ ok: true });
    expect(click.calls).toHaveLength(1);
    const [call] = click.calls;
    expect(call?.url).toBe('https://merchant.click.test/v2/merchant/payment/ofd_data/submit_items');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Auth: '3333:4d3f62489dbc19114297581bcfa0d906f84df0cd:1712345678',
    });
    const sent = call?.init?.body;
    expect(typeof sent).toBe('string');
    expect(JSON.parse(typeof sent === 'string' ? sent : '')).toEqual(body);
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('takes a numeric error_code written as text', async () => {
    const click = fake(() => Promise.resolve(Response.json({ error_code: '0' })));
    expect(await submitReceipt({ env: ENV, fetch: click.fetch, now }, body)).toEqual({ ok: true });
  });

  it('turns a refusal, an HTTP error, a bad answer or no answer into an error', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [
        () => Promise.resolve(Response.json({ error_code: -5, error_note: 'Payment not found' })),
        'Click refused it: -5 Payment not found',
      ],
      [
        () => Promise.resolve(new Response('Bad gateway', { status: 502 })),
        'Click answered HTTP 502',
      ],
      [
        () =>
          Promise.resolve(Response.json({ error_code: -1, error_note: 'Auth' }, { status: 401 })),
        'Click answered HTTP 401: -1 Auth',
      ],
      [() => Promise.resolve(Response.json({ ok: true })), 'Click’s answer had no error_code.'],
      [() => Promise.reject(new TypeError('fetch failed')), 'Click didn’t answer (TypeError).'],
    ];
    for (const [answer, error] of cases) {
      const click = fake(answer);
      expect(await submitReceipt({ env: ENV, fetch: click.fetch, now }, body)).toEqual({
        ok: false,
        error,
      });
    }
  });

  it('asks nothing while its env is missing, and never echoes a value', async () => {
    const click = fake(() => Promise.resolve(Response.json({ error_code: 0 })));
    const result = await submitReceipt(
      { env: { ...ENV, CLICK_MERCHANT_API_URL: ' ' }, fetch: click.fetch, now },
      body,
    );
    expect(result).toEqual({
      ok: false,
      error:
        'CLICK_MERCHANT_USER_ID, CLICK_SECRET_KEY or CLICK_MERCHANT_API_URL is not set on the web service.',
    });
    const bad = await submitReceipt(
      { env: { ...ENV, CLICK_MERCHANT_API_URL: 'not a url' }, fetch: click.fetch, now },
      body,
    );
    expect(bad).toEqual({ ok: false, error: 'CLICK_MERCHANT_API_URL is not a URL.' });
    expect(click.calls).toEqual([]);
    expect(JSON.stringify([result, bad])).not.toMatch(/SECRET123|301234567/);
  });
});
