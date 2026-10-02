# Turn on payments

Payments are built and switched off (`docs/DECISIONS.md` → "Payments: three providers behind one interface, built and switched off"). Three locks keep them off, and all three must open before anyone can buy:

1. `PAYMENTS_ENABLED=true` on the web service (the global kill switch);
2. the admin switch for the provider (Admin → Payments);
3. the provider's keys, and for Click and Payme the fiscal receipt codes in `config/business.ts`.

Do it in this order. Part A is paperwork outside the code and takes weeks; start it early. Part B takes an hour. Turn on one provider at a time, and make one test purchase with each before the next.

## A. Outside the code (Astro)

1. **A seller who can be paid.** Click and Payme contract only with a legal entity (MChJ) or an individual entrepreneur (YaTT) or a registered self-employed person, with a bank account in Uzbekistan in that name. Paddle pays out to the same account (or a Payoneer or Wise account in your name).
2. **Paddle** (worldwide, USD; Paddle is the merchant of record and handles tax):
   - Finish Paddle's business verification and get the live account approved. Paddle reviews the live website, so the site must be public with final Terms, Privacy and Refunds pages (`docs/08`).
   - In both the sandbox and the live dashboard, approve the site's domain for checkout and set **Checkout settings → Default payment link** to `SITE_URL/credits/buy`. Paddle refuses to create transactions until it's set.
   - Optional: create one product with three prices (Starter $5, Creator $15, Studio $40, tax included, quantity 1 to 1, no country price overrides) and put their ids in `config/business.ts` → `paddlePriceIds` (`sandbox` and `live`). Without them checkout uses a one-off price of the same amount. A payment is credited only when its total and currency are exactly the purchase's, so a price that adds tax on top, or charges another currency, is kept as an error (it alerts) instead of credited.
3. **Click** (Uzbekistan, Uzcard and Humo, in sum): sign the merchant contract for an online shop ("Shop API"); Click gives the service id, merchant id, merchant user id and secret key.
4. **Payme** (Uzbekistan, in sum): sign the merchant contract for the Merchant API; Payme gives the merchant id (cashbox id), a test key and a live key. In Payme's cabinet the account field must be named `order_id`.
5. **Fiscal receipts (OFD).** Click and Payme send a receipt to the tax service with every sale:
   - Find the MXIK (IKPU) code for the service ("credits for online services" or the nearest class) and its package code (o'lchov birligi) at tasnif.soliq.uz.
   - Put them in `config/business.ts` → `fiscalReceipt.mxik` and `fiscalReceipt.packageCode` (and `vatPercent` if the seller pays VAT) in a pull request. Click and Payme refuse to switch on while either is empty.
   - Click's receipt also needs the seller's TIN or PINFL and isn't wired yet (`docs/DECISIONS.md` → "Click: Prepare and Complete"). Click's switch refuses to turn on until both are built: then remove Click's entry from `UNFINISHED` in `apps/web/src/server/payments/switches.ts` in the same pull request.

## B. The switches

### 1. Keys as Railway shared variables

In Railway → the project → Shared variables, add each provider's keys (the names its `requiredEnv` lists; Admin → Payments shows which are set, never their values):

| Provider | Variables |
|---|---|
| Paddle | `PADDLE_API_KEY` (an API key with transactions, customers and adjustments), `PADDLE_WEBHOOK_SECRET` (from step 3 below), `PADDLE_ENVIRONMENT` (`sandbox` first, then `production`), `PADDLE_CLIENT_TOKEN` (a client-side token) |
| Click | `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_MERCHANT_USER_ID`, `CLICK_SECRET_KEY` |
| Payme | `PAYME_MERCHANT_ID`, `PAYME_KEY` (the test key first), `PAYME_TEST` (`true` first, `false` for real money) |

Then reference them on the web service in `.railway/railway.ts`, in a pull request (CI shows the plan; the merge applies it):

```ts
    env: {
      // …what's there,
      PAYMENTS_ENABLED: 'true',
      PADDLE_API_KEY: shared('PADDLE_API_KEY'),
      PADDLE_WEBHOOK_SECRET: shared('PADDLE_WEBHOOK_SECRET'),
      PADDLE_ENVIRONMENT: shared('PADDLE_ENVIRONMENT'),
      PADDLE_CLIENT_TOKEN: shared('PADDLE_CLIENT_TOKEN'),
      // Click and Payme the same way, once their contracts are signed:
      // CLICK_SERVICE_ID, CLICK_MERCHANT_ID, CLICK_MERCHANT_USER_ID, CLICK_SECRET_KEY,
      // PAYME_MERCHANT_ID, PAYME_KEY, PAYME_TEST
    },
```

Reference only the providers whose variables exist. Optional but wise at the same time: a `WELCOME_GRANT_SECRET` (32+ random characters) so the welcome-grant claims no longer depend on `BETTER_AUTH_SECRET` (`docs/runbooks/rotate-secrets.md`).

### 2. The kill switch

`PAYMENTS_ENABLED: 'true'` is in the same pull request. After the deploy, Admin → Payments → Kill switch says `true`. Nothing is sold yet: every provider's admin switch is still off, so `/credits/buy` still answers 404. A webhook path answers once its provider's keys are set, switched on or not, but refuses any new payment until the switch is on.

### 3. Cloudflare Access: let the providers in

While the site is behind Access, the providers' servers can't reach their webhooks. In Cloudflare Zero Trust → Access → Applications, add one **self-hosted application per path**, each with a single **Bypass** policy for Everyone:

- `SITE_HOST/api/webhooks/paddle`
- `SITE_HOST/api/webhooks/click`
- `SITE_HOST/api/webhooks/payme`

Exactly these paths, nothing wider: each one checks its provider's own signature or password, and answers 404 while its provider's keys are missing. The web service already skips its own Access check for `/api/webhooks/` (`apps/web/src/server/access.ts`). Once the site goes public and Access comes off, these apps can go too.

### 4. Register the webhook URLs with each provider

Admin → Payments shows each URL (from `SITE_URL`):

- **Paddle** → Developer tools → Notifications → New destination: URL `SITE_URL/api/webhooks/paddle`, events `transaction.paid`, `transaction.completed`, `adjustment.created`, `adjustment.updated`. Copy its secret key into `PADDLE_WEBHOOK_SECRET`. Same in the sandbox and live dashboards.
- **Click** → merchant cabinet → the service: Prepare URL and Complete URL both `SITE_URL/api/webhooks/click`. The buyer comes back to `SITE_URL/credits/return?purchase=…` by itself.
- **Payme** → merchant cabinet → the cashbox → Endpoint URL `SITE_URL/api/webhooks/payme`. Run Payme's own sandbox checks (sandbox.paycom.uz) against it with the test key until they all pass.

### 5. The admin switch

Admin → Payments → the provider → **Switch on**, with a reason (it goes into the audit log). It refuses, and says why, while a key or a fiscal code is missing. Once on, "Taking money now: yes", "Buy credits" shows on `/account` and on tool pages when a job needs credits, and `/credits/buy` offers the provider: Click and Payme first to visitors from Uzbekistan, Paddle first to everyone else.

### 6. A test purchase

With sandbox or test keys first, then again live with real money:

1. Sign in with an ordinary account, open `/account` → Buy credits, buy the Starter pack.
2. Pay: Paddle's test card in the sandbox (4242 4242 4242 4242), Payme's test card, or a real card live.
3. `/credits/return` says "Credits added"; `/account` shows the purchase as Paid and 200 more credits.
4. Admin → Payments: the purchase is `completed`; its webhook events have no error.
5. Refund it: Paddle from Admin → Payments → Refund with the amount (try part of it first, say $2.50, then the rest); Payme from its cabinet; Click from its cabinet, then Admin → Payments → "Record refund" with the amount refunded there. A part takes that share of the credits (`partially_refunded`); the whole payment makes it `refunded` and the 200 credits come off (the balance may go below zero if some were spent; paid jobs then wait for a top-up). With Paddle, check the refunded amount in Paddle's dashboard matches what you typed.
6. Live: switch the provider's keys to live (`PADDLE_ENVIRONMENT=production`, `PAYME_TEST=false`, live keys), deploy, and buy once more.

## Turning it off

- **Every sale at once:** set `PAYMENTS_ENABLED` to `false` (or remove it) on the web service. Checkouts answer 404 at once and no new payment starts; balances, free daily jobs and the welcome grant carry on.
- **One provider:** Admin → Payments → Switch off, with a reason.
- Either way, while a provider's keys are set its webhook path still answers calls about purchases already made: approved refunds and chargebacks take their credits back, and a buyer who opened a checkout just before still gets the credits they pay for.
- **Its webhook too** (a problem in the webhook itself): remove the provider's keys from the web service as well. Its path then answers 404 and the provider retries for a while (Paddle for 3 days); replay what failed afterwards.
- Providers retry webhooks they couldn't deliver; after turning back on, replay any that failed ([webhook-outage.md](webhook-outage.md)).
