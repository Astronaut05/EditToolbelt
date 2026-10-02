# Production

The private live site (`docs/01-architecture.md` → Hosting): only Astro, through Cloudflare Access. This page names every setting and where it lives. It never holds a value: secrets live only in Railway's variables and GitHub's secrets.

## What runs where

| Part | Where | Notes |
|---|---|---|
| Web (Next.js server build) | Railway, project `edittoolbelt`, service `web`, EU West (Amsterdam) | `apps/web/Dockerfile`, port 8080. Pre-deploy runs the migrations; Railway's health check is `/readyz`. |
| Worker (jobs, alerts, sweeper) | Railway, service `worker` | `apps/worker/Dockerfile`, 2 job slots, container disk only (100 GB, the largest input is 10 GiB). |
| Postgres 18 | Railway, service `postgres` | Private network only. Restoring: [restore-database.md](restore-database.md). |
| Files | Cloudflare R2, bucket `edittoolbelt-files`, EU jurisdiction | Lifecycle: delete after 1 day, abort multipart after 1 day (the backstop; the sweeper deletes outputs after 60 min). CORS: the site's origin only. |
| DNS, TLS, Access | Cloudflare | Access (Zero Trust, free) covers the site and `www`: one email allowed, plus CI's service token. |
| GPU jobs | Modal, app `edittoolbelt-gpu` | Per-second, scales to zero. The worker calls it; files move through presigned R2 URLs. |
| Email | The SMTP provider (`SMTP_URL`) | Sign-in links and alert emails. SPF, DKIM and DMARC in Cloudflare DNS. |

Spending limits: Railway $30 a month (hard), Modal $20 a month.

## Settings

### Railway → project `edittoolbelt` → Shared variables

The services reference these (`.railway/railway.ts`); a reference to one that isn't set reads as empty, and the services treat empty as unset.

| Name | Used by | From |
|---|---|---|
| `S3_ENDPOINT` | web, worker | R2's EU S3 endpoint for the account |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | web, worker | The R2 token scoped to `edittoolbelt-files` (Object Read & Write) |
| `SMTP_URL` | web, worker | The email provider's SMTP URL |
| `BETTER_AUTH_SECRET` | web | 32 random bytes, base64 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | web | Google Cloud → the OAuth client for the site |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | web | Zero Trust → the team domain, and the Access application's audience tag |
| `ALERT_EMAIL` | worker | Where alert emails go |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | worker | The alert bot (optional; email alone works) |
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | worker | Modal → a token for the workspace |

Everything else the services read is set in `.railway/railway.ts` itself (no secrets there): `APP_ENV`, `SITE_URL`, `DATABASE_URL` (a reference to Postgres), `S3_BUCKET`, `MAIL_FROM`, `WORKER_SLOTS` (CPU jobs at once), `WORKER_GPU_SLOTS` (GPU jobs at once, in slots of their own), `GPU_BACKEND` (`modal`; without the Modal token the worker starts with its GPU tools off and logs `gpu.off`). Payments add their own variables, switched off; `turn-on-payments.md` lists them once M5 lands.

### GitHub → Settings → Secrets and variables → Actions

| Name | Kind | Used by |
|---|---|---|
| `SITE_URL` | variable | Railway's plan, Ops checks, Smoke |
| `RAILWAY_TOKEN` | secret | Railway (plan and apply) |
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | secrets | Modal (deploy on merge) |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | secrets | Ops checks → `r2` |
| `CF_READ_TOKEN`, `CF_ACCOUNT_ID` | secrets | Ops checks → `cloudflare-r2`, `dns`, `access` (a read-only Cloudflare token) |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | secrets | Ops checks → `site`, Smoke (the Access service token) |

GitHub → Settings → Environments → `railway`: Astro is the required reviewer, so nothing changes Railway's setup without Astro's approval.

## Deploying

1. A PR merges to `main`.
2. Railway sees the commit, waits for its GitHub checks, builds both images, runs the migrations (pre-deploy), and swaps in the web service once `/readyz` answers. A failed migration or health check keeps the old version running.
3. Railway reports the deploy to GitHub as a deployment; **Smoke** waits until `/healthz` names the new commit, then checks the site through Access (private without a token, ready, security headers, `www` redirect). A red Smoke run is fixed first, before any other work.
4. A merge that touches the GPU app also deploys it to Modal (Actions → **Modal**).

Changing Railway's setup (services, variables, regions) is a PR to `.railway/railway.ts`: CI shows the plan. Applying it: Actions → **Railway** → Run workflow on `main` → Astro approves → it plans again and applies that plan. It never removes anything.

Custom domains are added in Railway's dashboard (its configuration can't register them): service `web` → Settings → Networking → Custom domain, port 8080, for the site's host and `www`. Each gets a CNAME (proxied) and a `_railway-verify` TXT record in Cloudflare; Cloudflare's SSL mode is Full (strict).

## Rolling back

- A bad release: Railway → service → Deployments → the last good one → Redeploy. Then revert the PR on GitHub, so the next merge doesn't bring it back.
- A bad migration: migrations only add (`docs/04`); write a new one that undoes it and merge it. Never edit an applied migration.
- One tool misbehaving: [disable-a-tool.md](disable-a-tool.md), no deploy needed.

## Everyday commands

- The first admin: sign in once on the site, then Railway → service `web` → the deployment's shell (or `railway ssh --service web` from a terminal) → `pnpm admin:promote <email>`. Then set up two-factor at `/admin/two-factor`.
- Logs: Railway → service → Logs. They never contain file names, file contents or secrets.
- Checks from outside: Actions → **Ops checks** → Run workflow (empty runs every check whose secrets are set; `site` checks the live site; `r2` round-trips a test file through storage).
- Draining the worker before maintenance: [drain-workers.md](drain-workers.md).
