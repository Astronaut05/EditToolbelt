# 07 — Admin, logging and monitoring

## Admin panel

Route `/admin`, same Next.js app, role `admin` only. Protected by: admin role + 2FA (TOTP) required for admin accounts + optional IP allowlist (env). Every write action writes `admin_audit_log` with a required reason.

It's a tool for one person — plain, dense, fast. Use the design system; no charts library beyond a simple sparkline/bar component.

### Pages

| Page | What it shows / does |
|---|---|
| **Dashboard** | Last 24 h / 7 d: server jobs (ok/failed), failure rate by tool, queue depth now, p95 wait and run time, GPU-seconds and estimated cost, credits sold and revenue (from `purchases`), new users, top client tools (from analytics). Worker and GPU backend health (heartbeats). Storage bytes in bucket. |
| **Tools** | Every registry tool: code, name, category, default status, override status, runtime, today's jobs/failures. Actions: set status (`live/beta/soon/disabled`), maintenance message, cost override, limits override, surfaces override. Changes apply within 30 s (registry cache TTL). |
| **Jobs** | Filter by tool, status, source, user, date. Job detail: metadata, options, timings, attempts, error code/detail, credits quoted/charged, worker, GPU seconds. **No file access** — admin cannot download user files. Actions: cancel (with refund), retry (if input still exists). |
| **Users** | Search by email. Detail: tier, balance, ledger, purchases, recent jobs, API keys, flags. Actions: grant/debit credits (reason required), revoke keys, disable account, trigger data export, delete account. |
| **Payments** | The kill switch (`PAYMENTS_ENABLED`, read-only); per provider: taking money now, the admin switch (on/off with a reason, refused while keys or fiscal codes are missing), its keys and fiscal fields (set or missing, never values), its webhook URL. Purchases newest first, filtered by provider, status and email, with Paddle's "Refund" (through its API) and Click's "Record refund" (after a refund in Click's cabinet). Recent webhook events with processing time and errors, never payloads; failed events are processed again when the provider retries or Paddle replays them. |
| **Costs** | GPU/CPU cost per tool vs credits charged, margin per tool, serverless vs dedicated break-even (see `05`). |
| **System** | Config values in effect (non-secret), app version/commit, migration version, retention sweeper last run + objects deleted, lifecycle rule check, ledger invariant check result. |
| **Audit log** | All admin actions. |

## Logging

Two separate things:

1. **Operational logs** (files/stdout) — for debugging.
2. **Job records + daily stats** (DB) — for product decisions. See `04-data-model.md`.

### Operational logs

- Structured JSON, one event per line. Node: pino. Python: structlog. Same field names in both.
- Common fields: `ts`, `level`, `service` (`web`/`worker`/`sweeper`), `env`, `version`, `request_id`, `job_id`, `tool_id`, `user_ref` (user id, never email), `event`, `duration_ms`, `error_code`.
- Every job logs: `job.claimed`, `job.probe`, `job.started`, `job.progress` (at most every 10 %), `job.succeeded|failed` with timings, sizes (bytes only), GPU/CPU seconds.
- **Never log:** filenames, file contents, emails, IPs (not logged by the app; IP rate limiting happens at Cloudflare's edge), presigned URLs, API keys, auth tokens, full request bodies, payment payloads (store those only in `webhook_events`).
- A redaction layer in the logger drops known sensitive keys and patterns (URLs with signatures, `Bearer `, emails) as a backstop.
- Levels: `debug` off in production; `info` for lifecycle; `warn` for retries/fallbacks; `error` for failures with stack.
- Destination: stdout from containers → collected on the host by Docker's log driver into files with rotation (daily, 14 days, compressed), **or** shipped to a log service later. Either way, retention ≤ 30 days — logs are not an archive.

### Error tracking

- Sentry-compatible error tracking (Sentry SaaS with EU data region, or self-hosted GlitchTip) for web (server + browser) and worker.
- `sendDefaultPii: false`; scrub request bodies, cookies, query strings; no session replay.
- Browser errors from client tools include engine id, capabilities summary and file MIME/size bucket — never the file or name.

### Client-side tool telemetry

Client tools don't create DB rows. Their success/failure comes from cookieless analytics events (`09-seo-and-growth.md`): `tool_run_succeeded` / `tool_run_failed` with `tool_id`, `engine`, `path` (webcodecs/ffmpeg-wasm/webgpu/wasm), duration bucket, error code. That's how you learn which tools people use and where browsers fail.

## Alerts

Send to a private **Telegram bot** (outbound messages only; bot token in env) and email as backup. Alert, with a 30-min cool-down per rule, when:

- Any tool's server failure rate > 10 % over 30 min with ≥ 10 jobs.
- Queue wait p95 > 2 min for 10 min.
- Worker or GPU backend heartbeat missing > 2 min.
- Webhook processing error, or ledger invariant mismatch (immediate, no cool-down).
- Retention sweeper hasn't completed in 30 min; any object in the bucket is older than 2 h (the sweeper should already have removed it — lifecycle is only the ≤ 48 h backstop); an incomplete multipart upload is older than 2 h; or the lifecycle rules are missing.
- Disk > 80 % on any host; DB connections > 80 % of max.
- Tool margin < 2× for a week (daily digest, not a page).

Plus a **daily digest** message at 09:00 Asia/Tashkent: yesterday's jobs, failures, revenue, new users, top tools, top failing tools.

## Health endpoints

- `GET /healthz` — process up.
- `GET /readyz` — DB reachable, storage reachable, registry loaded.
- Worker exposes the same on an internal port. Uptime monitoring hits `/readyz` every minute from outside.
