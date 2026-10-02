# 05 — Credits and payments

## Model

- **Browser tools are free, unlimited, no account.** They cost us nothing to run, and they're what brings people in from search.
- **Server tools cost credits.** Credits are bought in packs, **never expire**, no subscription.
- A small **free allowance** of server jobs lets people try the AI tools before paying. **Server jobs require sign-in** (decided 2026-09-29): anonymous visitors get every browser tool, free and unlimited, but no server jobs. An IP-based anonymous quota fails on mobile carrier NAT (many strangers share one IPv4) and is easy to dodge on IPv6; an email link takes ~10 s and unlocks the welcome grant anyway.
- Credit costs per tool are set from real GPU/CPU cost with a margin, and can be tuned in admin without a deploy.

All numbers below are **starting placeholders** in `config/business.ts`. Revisit after two weeks of real job data.

## Packs (placeholder)

| Pack id | Credits | Paddle (USD, incl. tax) | Per credit | Click and Payme (UZS) |
|---|---|---|---|---|
| `starter` | 200 | $5 | 2.5¢ | 63,000 |
| `creator` | 700 | $15 | 2.1¢ | 189,000 |
| `studio` | 2,000 | $40 | 2.0¢ | 499,000 |

Rules: no pack under the payment provider's practical minimum — Paddle charges 5% + $0.50 per transaction, so the smallest pack is $5 (decided 2026-09-29; at $3 the fixed part alone was ~17%); bigger packs are always cheaper per credit, in both currencies; USD prices are set in USD and Paddle localises the display currency. UZS prices are whole sums near the USD price (about 12,700 UZS per dollar), reviewed with the exchange rate. Amounts are stored in minor units: cents, and tiyin (1 sum = 100 tiyin).

## Free allowance (placeholder)

| Who | Allowance |
|---|---|
| Anonymous | Browser tools only. Server tools show "Sign in to process on our servers" instead of a price |
| Signed-in, never paid | 30 credits one-time welcome grant + 3 small jobs/day |
| Paid | Credits as bought; no daily cap except rate limits |

The daily allowance is tracked in `free_quota` by user id. Free previews (upscale crop, stem and noise snippets) count against it.

## Pricing a job

Every server tool defines a `CreditRule` in the registry:

```ts
type CreditRule =
  | { kind: 'free' }
  | { kind: 'flat'; credits: number }
  | { kind: 'perMinute'; credits: number; minCredits: number }      // audio/video
  | { kind: 'perMegapixel'; credits: number; minCredits: number }   // images, on OUTPUT megapixels
  | { kind: 'tiered'; tiers: { upTo: number; unit: 'sec'|'mp'; credits: number }[] };
```

- Price is computed **server-side** from probed metadata (never trust the client's numbers), shown to the user, and stored as `credits_quoted`. The user must confirm the quote; if probing reveals a different price than the client estimated, show the new quote before starting.
- Setting a tool's price: `credits = ceil( (expected_cost_usd × margin) / credit_net_usd )` with `margin = 3`. `credit_net_usd` is what one credit really brings in on the **pack that's worst for us** (biggest discount), after tax and fees:
  `credit_net_usd = min over packs of ( price / (1 + typical_vat) − (0.05 × price + 0.50) ) / credits`
  Prices are tax-inclusive; `typical_vat` = 0.20 as a planning figure; confirm in the Paddle dashboard which amount the 5% is taken from. With the placeholder packs this is ≈ 1.54¢ (studio; starter ≈ 1.71¢, creator ≈ 1.61¢), not the starter pack's 2.5¢ list price — pricing off the list price would make every tool's real margin about half what the formula claims, and the studio pack would sit under the 2× alert from day one. Compute it in `config/business.ts`; never hand-type it.
- Free usage (welcome grants, daily free jobs) is tracked as its own cost line in `/admin/costs`, so margin alerts measure paid usage only. Expected cost = measured GPU-seconds × provider $/sec (+ CPU and egress, usually negligible). Admin shows actual cost vs. charged per tool; if a tool's margin falls under 2× for a week, alert.

## Welcome grant (as built, M5)

- 30 credits (`freeAllowance.welcomeGrantCredits`) after each sign-in once the email is verified (the link or Google verify it), as a `welcome_grant` ledger row.
- Once per email: the claim is `welcome_grant_claims.email_hmac` = HMAC-SHA256 of the normalised email (lowercase, `+tag` dropped, Gmail's dots dropped, so aliases of one inbox share one grant) with `WELCOME_GRANT_SECRET` (unset: derived from `BETTER_AUTH_SECRET`). It outlives account deletion; an account that has its grant row never gets another, even after its claim is purged at 12 months.
- Throwaway-inbox domains (`disposableEmailDomains` in config, subdomains too) get no grant; signing in still works.
- `WELCOME_GRANT_ENABLED=false` stops it at once (abuse); the server build's e2e tests run with it off.

## Reserve → capture → release

1. Job created → `reserve` (−quote). If balance < quote → `402` with `credits`, `balance`, `shortfall` and, while credits are on sale, `buy_url`.
2. Job succeeds → `capture` (0-amount marker; `credits_charged = quote`).
3. Job fails / is cancelled / expires → `release` (+quote). The UI says "Credits returned".
4. If a job is cancelled by the user mid-run: full release (keep it simple and generous).
5. The job is started with the quote's price and what pays (`quote_credits`, `quote_funding`): if either changed since the quote (today's free jobs ran out, say), `409` and nothing is reserved; the site shows the new quote and asks again. A free daily job never turns into a paid one unasked.

All through `applyCredit()` (see `04-data-model.md`), inside one DB transaction with the job status change.

## Payments (as built, M5): three providers, switched off

`docs/DECISIONS.md` → "Payments: three providers behind one interface, built and switched off" and the provider entries after it. Turning them on: `docs/runbooks/turn-on-payments.md`.

- **Paddle** (worldwide, USD): merchant of record, so it calculates, collects and remits VAT/GST/sales tax worldwide, handles chargebacks and fraud, and supports sellers in Uzbekistan. We never handle cards and never register for VAT.
- **Click** and **Payme** (Uzbekistan, UZS, Uzcard and Humo): local acquiring with a fiscal receipt per sale (MXIK/IKPU and package code from `config/business.ts` → `fiscalReceipt`).

The seam is `PaymentProvider` (`apps/web/src/server/payments/contract.ts`): `createCheckout(purchase, buyer, ctx)`, `handleWebhook(request, ctx)` (Paddle's signed webhooks, Click's Prepare and Complete, Payme's JSON-RPC: one call, since Click and Payme are request-and-answer protocols), and `refund(purchase, ctx)` where the provider has a refund API (Paddle). A provider is one file in `payments/providers/`.

**Off until three locks open:** `PAYMENTS_ENABLED=true` (env, the kill switch), the admin's switch per provider (Admin → Payments, `payment_settings`, audit-logged, refused while a key or fiscal code is missing), and the provider's `requiredEnv` all set. While a provider is off its webhook path answers 404 and nothing offers it; with all off there's no "Buy credits" anywhere, `/credits/buy` and `POST /credits/checkout` answer 404, and balances, free daily jobs and the welcome grant work as before.

**Buying:**
1. `/credits/buy` (signed in; never COEP): the packs and the providers that are on. Visitors from Uzbekistan (`cf-ipcountry: UZ`) see Click and Payme first, priced in sum; everyone else sees Paddle first, in dollars; anyone can pick another.
2. "Buy" → `POST /api/v1/credits/checkout { pack_id, provider }` (session only, never API keys): a `pending` purchase at the pack's price in the provider's currency, then the provider's checkout: a full-page redirect (Click, Payme) or Paddle.js's overlay on the same page. Paddle's default payment link is `/credits/buy` too (`?_ptxn=` reopens the buyer's own transaction). Its CSP allows Paddle's origins only on that page, and only while payments are on and Paddle is set up.
3. The provider calls `/api/webhooks/<provider>`. The provider code checks the signature or credentials, stores the event (`webhook_events`, unique per provider and event id: fresh again until processed without an error, so retries after a failure are processed), and moves the purchase through a `PurchaseStore`, never the ledger directly.
4. `/credits/return?purchase=…` follows the purchase until it settles and says what happened. Arriving there never adds credits: only the provider's call does (`docs/11` → Payments).

**The store** (`payments/store.ts`): `complete` (pending → completed, `+credits` `purchase` row) and `refund` (→ `refunded`, `partially_refunded` or `chargeback`, `−credits` `refund_purchase` row, never more than is left) each move the purchase and write the ledger row in one transaction, idempotent (one `purchase` row per purchase, one refund row per refund id). A refund may take the balance below zero; a negative balance blocks paid jobs until it's topped up. `cancel` (pending → cancelled) writes no row. Pending purchases are never cancelled for age: Payme may still pay an order up to 7 days old.

**Refunds and chargebacks:** Paddle's approved refund and chargeback adjustments take credits back (chargebacks flag the account in Admin → Users); Admin → Payments → Refund asks Paddle for a full refund. Payme refunds made in its cabinet arrive as its CancelTransaction. Click has no refund call: refund in Click's cabinet, then Admin → Payments → Record refund.

**History:** `/account` lists the user's purchases (date, pack, credits, amount, status); receipts and invoices come from the provider. Admin → Payments lists every purchase and the webhook events; the dashboard shows sales.

## Refunds (policy — mirror in Terms, see `08`)

- Unused credit packs: refundable within 14 days of purchase, on request, for the unused portion.
- Used credits aren't refundable, but any failed job refunds itself automatically.
- EU/UK consumers: at checkout, the buyer agrees that delivery (credits added) starts immediately and acknowledges this affects the withdrawal right — Paddle's checkout covers this as seller of record; our Terms state the generous 14-day unused-credit refund anyway.

## GPU backend economics

Keep a small sheet in admin (`/admin/costs`):
- `serverless_monthly = Σ gpu_seconds × serverless_$per_sec`
- `dedicated_monthly = rented GPU server price` (+ ops time)
- Switch to `DedicatedGpu` when `serverless_monthly > 0.7 × dedicated_monthly` for two consecutive months **and** peak concurrency fits one box. Keep serverless as overflow.

## Fraud and abuse

- Edge rate limits (Cloudflare) per IP on `/api/v1/uploads` and `/api/v1/jobs`.
- App-level: max concurrent server jobs per user (free 2, paid 4 — placeholders).
- Welcome grant only after email verification; one per email (aliases included); disposable-email domains blocked for the grant (list in config).
- Paddle handles payment fraud; chargebacks auto-flag the account (Admin → Users). Checkout is rate-limited per account (10 a minute).
