# 05 — Credits and payments

## Model

- **Browser tools are free, unlimited, no account.** They cost us nothing to run, and they're what brings people in from search.
- **Server tools cost credits.** Credits are bought in packs, **never expire**, no subscription.
- A small **free allowance** of server jobs lets people try the AI tools before paying. **Server jobs require sign-in** (decided 2026-09-29): anonymous visitors get every browser tool, free and unlimited, but no server jobs. An IP-based anonymous quota fails on mobile carrier NAT (many strangers share one IPv4) and is easy to dodge on IPv6; an email link takes ~10 s and unlocks the welcome grant anyway.
- Credit costs per tool are set from real GPU/CPU cost with a margin, and can be tuned in admin without a deploy.

All numbers below are **starting placeholders** in `config/business.ts`. Revisit after two weeks of real job data.

## Packs (placeholder)

| Pack id | Credits | Price (USD, incl. tax shown by Paddle) | Per credit |
|---|---|---|---|
| `starter` | 200 | $5 | 2.5¢ |
| `creator` | 700 | $15 | 2.1¢ |
| `studio` | 2,000 | $40 | 2.0¢ |

Rules: no pack under the payment provider's practical minimum — Paddle charges 5% + $0.50 per transaction, so the smallest pack is $5 (decided 2026-09-29; at $3 the fixed part alone was ~17%); bigger packs are always cheaper per credit; prices are set in USD and Paddle localises display currency.

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

## Reserve → capture → release

1. Job created → `reserve` (−quote). If balance < quote → `402` with the shortfall and a link to buy.
2. Job succeeds → `capture` (0-amount marker; `credits_charged = quote`).
3. Job fails / is cancelled / expires → `release` (+quote). The UI says "Credits returned".
4. If a job is cancelled by the user mid-run: full release (keep it simple and generous).

All through `applyCredit()` (see `04-data-model.md`), inside one DB transaction with the job status change.

## Payments — Paddle as merchant of record

Why a merchant of record: Paddle is the legal seller, so it calculates, collects and remits VAT/GST/sales tax worldwide, handles chargebacks and fraud, and supports sellers in Uzbekistan. We never handle cards, and never register for VAT anywhere.

Implementation:
- `PaymentProvider` interface (`createCheckout(packId, user)`, `verifyWebhook(req)`, `parseEvent(evt)`, `refund(purchase)`) with `PaddleProvider` as the only implementation. Keep the seam so a second MoR can be added.
- Checkout: Paddle.js overlay on `/credits/buy` — a route **without** COEP headers.
- Paddle products/prices are created per pack; mapping lives in `config/business.ts` by environment (sandbox vs live).
- Webhooks at `/api/webhooks/paddle`: verify signature → insert `webhook_events` (unique `event_id`) → process idempotently:
  - transaction completed → `purchases.completed` + `purchase` ledger row.
  - refund → `refund_purchase` negative row (can take balance negative; negative balance blocks new paid jobs until topped up).
  - chargeback → same as refund + flag user in admin.
- Receipts and invoices come from Paddle. Our site shows purchase history from `purchases`.
- Test everything against the Paddle sandbox in CI (webhook fixtures) before live.

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
- Welcome grant only after email verification; one per email; disposable-email domains blocked for the grant (list in config).
- Paddle handles payment fraud; chargebacks auto-flag the account.
