# 06 — Public API

One API for everything: the website's own tool pages, the Premiere panel, the mobile PWA, and (later) third-party developers. The website does not use private shortcuts — if the site can do it, the API can.

## Basics

- Base: `/api/v1`. Breaking changes → `/api/v2`; v1 kept for at least 6 months after.
- JSON in/out. Errors are RFC 9457 `application/problem+json`: `{ type, title, status, detail, code, ...extra }` with stable `code` values (`INSUFFICIENT_CREDITS`, `FILE_TOO_LARGE`, `UNSUPPORTED_FORMAT`, `TOOL_UNAVAILABLE`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `NOT_FOUND`, `UNAUTHORIZED`, `IDEMPOTENCY_KEY_REUSED`, …). A code that needs more words has its own `type`, a link into `/developers`; the others are `about:blank`.
- Schemas defined once in Zod (`@etb/core/api`, `packages/core/src/api/`) → OpenAPI 3.1 generated at build → published at `/api/v1/openapi.json` and a docs page at `/developers`.
  Done as: each operation lists every status it can answer, successes and problems, with the codes under each; the end-to-end contract test fails on an answer whose status or code isn't listed for its route.
- Typed client `packages/api-client` generated from the same schemas; used by the web app and the panel.
- Rate-limit headers on every response: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.
  Done as: every call counts against a general budget of 600 a minute per key (or per account for the website), or 300 a minute per address for anonymous calls and refused keys or sessions; routes add their own, stricter limits. Each answer, errors included, carries the headers of the limit it is closest to, and a 429 adds `Retry-After`.
- CORS: our own origins only for cookie auth; API-key auth allowed from any origin (keys are secret, so browser use is the developer's own risk — docs say so).
  Done as: every answer carries `Access-Control-Allow-Origin: *` and never `Allow-Credentials`, so a browser won't give another site an answer made with our cookie (which is SameSite=Lax anyway); a cookie write must come from our origin.

## Auth

| Caller | Method |
|---|---|
| Website / PWA | Session cookie (Better Auth). Anonymous calls allowed for read-only endpoints (`GET /tools`); uploads and jobs need a signed-in user or an API key. |
| Premiere panel | API key obtained via **device-code flow**: panel calls `POST /auth/device` → shows a short code + opens `/connect` in the browser → user signs in and approves → panel polls `POST /auth/device/token` → receives a key scoped `jobs:read jobs:write account:read`, named "Premiere panel". |
| Developers | API key created in settings, shown once. Header: `Authorization: Bearer etb_live_…`. |

Keys are stored hashed; revocable; `last_used_at` updated at most once per minute.

Device flow, as built: `POST /auth/device` `{ client_name? }` (anonymous, 20 a minute per address) → `{ device_code, user_code: "BCDF-GHJK", verification_uri, verification_uri_complete, expires_in: 600, interval: 5 }`. The panel polls `POST /auth/device/token` `{ device_code }` every 5 s and gets problem+json `AUTHORIZATION_PENDING` (400), `SLOW_DOWN` (400, sooner than 4 s), `ACCESS_DENIED` (403) or `EXPIRED_TOKEN` (400, expired, unknown or already collected), then once `{ api_key, key_prefix, name, scopes }`. The key is made at that moment, so it is never stored.

At `/connect` (RFC 8628 §5.1), a wrong, expired or used code gets the same answer whichever it is, and counts as a miss against the signed-in account and its address; 10 misses in 10 minutes refuse every code, the right one too, until the window ends. Approving is refused while the account has 10 keys, and an approved code gives no key once its account is disabled or deleted (`ACCESS_DENIED`).

Scopes: `jobs:read` (jobs, progress, results), `jobs:write` (uploads, quotes, starting and cancelling jobs), `account:read` (`/me`). The session cookie can do all three. An answer never shows more than the caller's scopes allow: a job's `result` (its download URL) is left out without `jobs:read`, even where `jobs:write` reaches the job (cancelling a finished one, repeating a start), and a quote's `balance`, `balance_after` and `free_jobs_left` are left out without `account:read`. A request with an `Authorization` header is judged by its key alone: 401 for a wrong or revoked key, 403 for a missing scope. At most 10 live keys per account; rate limits count per key.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /tools` | Registry view: id, name, category, status, runtime, surfaces, accepts, limits for caller's tier, cost rule, and `server` (our servers run it now). Filter `?surface=panel`. |
| `GET /tools/:id` | One tool, including option schema (JSON Schema from Zod) so clients can render forms. |
| `POST /uploads` | `{ tool_id, bytes, mime }` → `{ upload_id, parts: [{ n, url }], part_size, complete_url }`. Validates size/type for tier. |
| `POST /uploads/:id/parts` | `{ from, count }` → fresh presigned URLs for the next parts. Part URLs expire in 15 min, so large uploads fetch them in batches. |
| `POST /uploads/:id/complete` | `{ parts: [{ n, etag }] }` → completes multipart. |
| `DELETE /uploads/:id` | Give up on an upload: its parts or file are deleted now → `200 { status: "cancelled" }` (twice answers the same). |
| `POST /jobs/quote` | `{ tool_id, upload_id, options }` → `{ credits, funding, can_start, free_jobs_left, balance, balance_after, estimate_seconds, options }` after server probe; `202 { status: "probing" }` with `Retry-After` while the probe runs. |
| `POST /jobs` | `{ tool_id, upload_id, options, quote_credits }` + `Idempotency-Key` header → `{ job }`. Rejects if the quote changed. A repeat with the same key and body answers the same job (200); the same key with another body gets `422 IDEMPOTENCY_KEY_REUSED`. A tool that takes a second file names its upload in an option (Burn Subtitles: `subtitles`, an SRT, VTT or ASS upload of up to 5 MB). |
| `GET /jobs/:id` | Job status, progress, result (when done: `download_url` presigned, expires in 10 min, `expires_at` of the object). |
| `GET /jobs/:id/events` | SSE progress stream. 5 open at once per account; past that `429 RATE_LIMITED` with `Retry-After` (polling `GET /jobs/:id` works too). |
| `POST /jobs/:id/cancel` | Cancel queued/running; releases credits. |
| `GET /jobs` | Caller's recent jobs (metadata only), paginated by cursor. |
| `GET /me` | Profile, tier, balance, free allowance left today. |
| `GET /me/credits` | Ledger, newest first, 50 a page by cursor: kind, amount, balance after, job id. No admin notes or purchase ids. |
| `POST /credits/checkout` | `{ pack_id }` → Paddle checkout data. Web only. |
| `POST /auth/device`, `POST /auth/device/token` | Panel connect flow. |
| `POST /webhooks/paddle` | Payment webhooks (not under the public docs). |

Client-only tools have no processing endpoint — they run in the browser. Calculators the panel needs come from `packages/core` directly, not the API.

## Job lifecycle over the API

```
POST /uploads → PUT parts to storage → POST /uploads/:id/complete
→ POST /jobs/quote → (user confirms) → POST /jobs
→ GET /jobs/:id/events (or poll) → GET download_url
```

## Panel-specific notes

- The panel lists tools from `GET /tools?surface=panel`, so admin toggles apply to the panel instantly.
- Upload/download happen from the panel runtime with `fetch`; keep part size modest (8 MB) for reliability.
- Imported results go into a bin named "EditToolbelt"; file names are generated locally from the clip name.
- The panel shows balance and a "Buy credits" button that opens the website.

## Versioning & stability

- Tool ids and option names are part of the API contract. Renames keep an alias for one version.
- Adding optional fields is non-breaking; removing/renaming fields is breaking.
- `GET /tools` includes `deprecated: true` on anything being removed, with `sunset` date.
