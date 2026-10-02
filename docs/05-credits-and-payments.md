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
- **Click** and **Payme** (Uzbekistan, UZS, Uzcard and Humo): local acquiring with a fiscal receipt per sale (MXIK/IKPU and package code from `config/business.ts` → `fiscalReceipt`). Payme sends the receipt itself from what CheckPerformTransaction answers. Click's we send: its Complete queues the receipt in the transaction that credits the sale (`fiscal_receipts`), and the web server sends it to Click's Merchant API (`ofd_data/submit_items`, the seller named by `fiscalReceipt.tin` or `.pinfl`), retrying 1, 2, 4 … minutes apart (at most 6 hours) until Click accepts it; one still unsent after 6 tries or an hour alerts. Admin → Payments shows each receipt and can send it again.

The seam is `PaymentProvider` (`apps/web/src/server/payments/contract.ts`): `createCheckout(purchase, buyer, ctx)`, `handleWebhook(request, ctx)` (Paddle's signed webhooks, Click's Prepare and Complete, Payme's JSON-RPC: one call, since Click and Payme are request-and-answer protocols), and `refund(purchase, ctx)` where the provider has a refund API (Paddle). A provider is one file in `payments/providers/`.

**Off until three locks open:** `PAYMENTS_ENABLED=true` (env, the kill switch), the admin's switch per provider (Admin → Payments, `payment_settings`, audit-logged, refused while a key or fiscal code is missing), and the provider's `requiredEnv` all set. While a provider is off nothing offers it and no new payment starts; with all off there's no "Buy credits" anywhere, `/credits/buy` and `POST /credits/checkout` answer 404, and balances, free daily jobs and the welcome grant work as before. Its webhook path answers 404 only while its keys are missing: switched off with keys set, it still answers calls about purchases already made (refunds, chargebacks, a payment for a checkout opened before the switch) and refuses new ones (Click's Prepare for a new Click transaction, Payme's CheckPerformTransaction and a new CreateTransaction). Click also stays off until the seller's TIN or PINFL is in `config/business.ts`, and `CLICK_MERCHANT_API_URL` is set.

**Buying:**
1. `/credits/buy` (signed in; never COEP): the packs and the providers that are on. Visitors from Uzbekistan (`cf-ipcountry: UZ`) see Click and Payme first, priced in sum; everyone else sees Paddle first, in dollars; anyone can pick another.
2. "Buy" → `POST /api/v1/credits/checkout { pack_id, provider }` (session only, never API keys): a `pending` purchase at the pack's price in the provider's currency, then the provider's checkout: a full-page redirect (Click, Payme) or Paddle.js's overlay on the same page. Paddle's default payment link is `/credits/buy` too (`?_ptxn=` reopens the buyer's own transaction). Its CSP allows Paddle's origins only on that page, and only while payments are on and Paddle is set up.
3. The provider calls `/api/webhooks/<provider>`. The provider code checks the signature or credentials, stores the event (`webhook_events`, unique per provider and event id: fresh again until processed without an error, so retries after a failure are processed; Click and Payme calls with the answer they got), and moves the purchase through a `PurchaseStore`, never the ledger directly. Paddle credits a payment only for the transaction checkout made, at the purchase's price, amount and currency; anything else is kept as the event's error, which alerts.
4. `/credits/return?purchase=…` follows the purchase until it settles and says what happened. Arriving there never adds credits: only the provider's call does (`docs/11` → Payments).

**The store** (`payments/store.ts`): `complete` (pending → completed, `+credits` `purchase` row) and `refund` (→ `refunded`, `partially_refunded` or `chargeback`, `−credits` `refund_purchase` row, never more than is left) each move the purchase and write the ledger row in one transaction, idempotent (one `purchase` row per purchase, one refund row per refund id). A refund may take the balance below zero; a negative balance blocks paid jobs until it's topped up. `cancel` (pending → cancelled) writes no row. Pending purchases are never cancelled for age: Payme may still pay an order up to 7 days old.

**Refunds and chargebacks:** Paddle's approved refund and chargeback adjustments take credits back (chargebacks flag the account in Admin → Users). Admin refunds follow the policy below, the unused portion: the admin gives the money refunded, and the credits come off in proportion to it (rounded, at least 1, never more than are left of the purchase).
- Paddle: Admin → Payments → Refund asks Paddle for that amount, a full refund for the whole payment and a partial one otherwise; the credits come off when Paddle approves.
- Payme: refunds made in its cabinet arrive as its CancelTransaction (the whole payment).
- Click: no refund call. Refund in Click's cabinet, then Admin → Payments → Record refund with the amount refunded there; the money recorded can't pass what was paid.

**History:** `/account` lists the user's purchases (date, pack, credits, amount, status); receipts and invoices come from the provider. Admin → Payments lists every purchase and the webhook events; the dashboard shows sales.

## Refunds (policy — mirror in Terms, see `08`)

- Unused credit packs: refundable within 14 days of purchase, on request, for the unused portion.
- Used credits aren't refundable, but any failed job refunds itself automatically.
- EU/UK consumers: at checkout, the buyer agrees that delivery (credits added) starts immediately and acknowledges this affects the withdrawal right — Paddle's checkout covers this as seller of record; our Terms state the generous 14-day unused-credit refund anyway.

## GPU costs and the daily budget

- **Prices:** Modal bills a function's container by the second: its GPU plus the CPU cores and memory it asks for. `config/business.ts` → `gpuPricing` holds T4 $0.000164/s and L4 $0.000222/s, CPU $0.0000131 per core-second and memory $0.00000222 per GiB-second, read 2026-10-02 from Modal's published prices (placeholders: confirm in Modal's dashboard). Every tool function asks for 2 cores and 8 GiB, so a T4 second costs $0.000208 and an L4 second $0.000266 (`gpuRateUsd`).
- **On every GPU job:** the jobs API writes the tool's rate (`jobs.gpu_rate_usd`, from the registry's `gpu` and `gpuRateUsd`). When a call ends, whatever happened, the worker adds its GPU seconds to `gpu_seconds` and its billed seconds × rate to `gpu_cost_usd`. Billed seconds, each an upper bound:
  - a warm call that worked: its GPU seconds (measured inside the function) + the function's idle window (10 s upscaler, 30 s Whisper), which is billed after a call unless another one arrives, so counting it every time errs high;
  - a cold call, or one the function reports as failed: the larger of that and the wall-clock time since the spawn, since Modal also bills the container's boot and imports, which the function can't time;
  - a call that didn't say (cancelled, timed out, raised, or its worker died): its wall-clock time + the longest idle window of any function (30 s). A dead worker's call is counted when the reaper finds it, then cancelled; one that can't be cancelled is charged to the job's time limit.
- **Pricing a job** is unchanged: the registry's `CreditRule` from the probe, server-side (Upscale Image on the result's megapixels). The rules' placeholders already clear the margin of 3: a minute of speech is about 5-10 GPU-seconds plus Whisper's load and idle window, about $0.005-0.015 for 2 credits (≈ 3.1¢); a 12 MP upscale is about 15-25 s on a T4, about $0.005 for 3 credits.
- **Wave 3 GPU tools (estimates until a real run measures them; Admin → Dashboard → GPU shows the margins):**
  - Object Eraser, 3 credits (≈ 4.6¢): a few seconds on a T4 plus the 10 s idle window, under 1¢ a photo.
  - Upscale Video, 10 credits a minute (≈ 15.4¢): 4× from 540p is about 45 GPU-seconds a minute of 30 fps video, but 2× from 1080p to 4K is about 180 (≈ 4.8¢, a margin of about 3) and the 4K encode on 2 cores can take as long, so 60 fps 4K sources sit near a margin of 1.6.
  - Video Background Remover, 8 credits a minute (≈ 12.3¢): BiRefNet_lite through ONNX Runtime is about 0.15-0.25 s a frame on an L4, 270-450 s a minute of 30 fps video (≈ 7-12¢), a margin of 1 to 1.7. The formula above gives about 20 credits a minute. The README's placeholders stand until the first real runs; then reprice in Admin → Tools, or make it cheaper to run (fp16 or TensorRT, a 4-core shape for the encoders).
- **The daily budget** (`gpu_budget`, one row, $1 a day until an admin changes it in Admin → Dashboard → GPU, audited):
  - Today's spend is every GPU job started since 00:00 UTC: its recorded cost plus, for a call still running, its time so far at its rate.
  - A GPU job starts only while today's spend, with every running GPU job counted at its worst case instead (its time limit + 30 s, at its rate), is under the budget. Claims take turns (an advisory lock) and check this in the claim's own transaction, so however many slots and workers claim at once, spend can pass the budget by at most one job's worst case, and only if every running job runs to its limit. Jobs that can't start wait in the queue; if they wait 15 min they expire and their credits come back (the usual expiry). CPU jobs carry on. A running GPU job ending, a raised budget, or midnight UTC starts them again.
  - At the default $1 a day this means one transcription at a time (its worst case is 70 min on an L4, about $1.13) or up to four upscales (about $0.25 each); raise the budget for more.
  - Wave 3: Object Eraser's worst case is 10 min on a T4, about $0.13 (its `maxConcurrent` of 2 binds first). Upscale Video's and Video Background Remover's are 95 min on an L4, about $1.52 each, over the default budget on its own: one starts like any GPU job, while today's committed spend is under $1, and then no other GPU job starts until it ends. Spend can then pass $1 by up to that $1.52, and only if the job runs to its limit (a test in `apps/worker/tests/test_gpu_consistency.py` holds these numbers to the registry and `config/business.ts`).
  - At 80 % and at 100 % of the spend an alert goes out, once a day each (`gpu_budget`, Telegram, email as backup). Runbook: `docs/runbooks/gpu-budget.md`.
- **Admin → Dashboard → GPU** shows today's spend against the budget, whether GPU jobs are starting (and why not), the prices in use, and GPU cost against credits by tool over 7 days: jobs, GPU seconds, cost, what free jobs cost (its own line, so margins measure paid use), credits charged, their worth at `creditNetUsd`, and the margin. The daily table adds GPU seconds and cost per tool.
- Modal's own monthly spend limit ($20) stays the last line behind all of this.

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
