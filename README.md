# EditToolbelt

Fast, no-install utilities for video, photo and audio editors: "the editor's toolbelt". Small jobs run free in the browser; heavy AI jobs run on our servers for credits.

The spec lives in this repo: start with [`CLAUDE.md`](CLAUDE.md), then [`docs/`](docs/) and [`tools/`](tools/). Milestones and their status: [`docs/12-milestones.md`](docs/12-milestones.md). Decisions made while building: [`CHANGES.md`](CHANGES.md).

## Run it locally

You need Docker with Compose 2.22 or newer (Docker Desktop is fine). Then, from a fresh clone:

```sh
docker compose up --watch
```

| Service  | Where                 | What                                                                                                            |
| -------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| web      | http://localhost:3000 | Next.js dev server, the server build: the site plus accounts. Edits under `apps/web` and `packages` hot-reload. |
| mailpit  | http://localhost:8025 | Inbox for the sign-in emails the stack sends. Nothing leaves your PC.                                           |
| migrate  | (runs once)           | Applies the database migrations, then exits; web and worker wait for it.                                        |
| worker   | (no port)             | Python worker. Runs a hello-world job against Postgres and storage, then idles.                                 |
| postgres | localhost:5432        | Postgres 18, user / password / db: `etb` / `etb-local-only` / `etb`                                             |
| storage  | http://localhost:7070 | S3-compatible storage (Versity S3 Gateway), key `etb-local` / `etb-local-secret`                                |

`--watch` syncs file changes into the containers (hot reload for web, rebuild for the worker). Plain `docker compose up` runs the same stack without it. Host ports can be moved with `ETB_WEB_PORT`, `ETB_POSTGRES_PORT`, `ETB_STORAGE_PORT`, `ETB_MAIL_PORT`. All credentials above are local placeholders.

**Signing in on the stack:** open http://localhost:3000/sign-in, enter any email, then open the link from the Mailpit inbox (http://localhost:8025). Your account is at `/account`: profile, "Download my data", and deleting it (signing in within 30 days restores it). For Google sign-in, put your own OAuth client's `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in a `.env` file next to `compose.yaml` (it is git-ignored; never commit it), with `http://localhost:3000/api/auth/callback/google` as the redirect URI.

**The admin on the stack:** sign in once, then `docker compose exec web pnpm admin:promote you@example.com`. Open http://localhost:3000/admin, set up two-factor with an authenticator app, and you're in: Dashboard, Tools (switch any tool's status or add a maintenance message; the site follows within 30 seconds), Users, Audit log and System.

**Two builds of one app:** the public site is a static export (`pnpm preview`, Cloudflare Pages after Go public). The server build (`ETB_TARGET=server`) is the same pages plus accounts, the admin and the API; the stack runs it, and it's production from M5. Route files named `*.server.tsx`/`.ts` exist only in the server build, `*.static.tsx`/`.ts` only in the static one.

Every service logs one JSON object per line (`ts`, `level`, `service`, `env`, `version`, `event`, …), e.g. `docker compose logs worker`.

Everything runs on this machine until the Go public step (see below): no domain, no Cloudflare.

## The production build, locally

Milestones are signed off against the real production build, served the way Cloudflare Pages will serve it later:

```sh
pnpm preview        # next build (static export), then http://localhost:4173
```

The server is `apps/web/scripts/serve.ts` (Node only, no dependencies). It applies the build's `_headers` file exactly as Cloudflare Pages will, and every page carries its own Content Security Policy (hashes of its inline scripts, written in by `apps/web/scripts/postbuild.ts`), so security headers and cross-origin isolation behave locally as they will in production. `pnpm preview --lan --https` serves it to phones on your Wi-Fi; see [Testing on phones](#testing-on-phones).

## Design workshop

The design screens in `docs/design/screens/` are rebuilt from the real components, with the fixture data they were drawn with (a typed search, some tools live, a run in progress), in a local-only workshop. Workshop routes never reach `pnpm preview` or CI builds.

```sh
pnpm workshop            # build with the workshop, serve on http://localhost:4173/workshop
pnpm design:compare      # second terminal: design PNG next to the build, light and dark, into ./screens-compare
```

`design:compare` and `pnpm samples` (re-renders the sample images) drive Chromium through Playwright; install it once with `pnpm exec playwright install chromium`.

## Checks

Outside Docker you need Node 24 (22.18+ works) with Corepack, and [uv](https://docs.astral.sh/uv/) for the worker.

```sh
corepack enable
pnpm install
pnpm check          # format, lint, typecheck, unit tests, license and host checks (JS side)
pnpm worker:check   # ruff, mypy, pytest, license check (apps/worker)
pnpm build          # static export of apps/web into apps/web/out
pnpm db:migrate     # apply migrations to DATABASE_URL
```

The database and server-build tests need a throwaway Postgres 18 database (they write rows that can't be deleted), e.g. one more database in the stack's Postgres:

```sh
docker compose exec postgres createdb -U etb etb_test
export TEST_DATABASE_URL=postgresql://etb:etb-local-only@localhost:5432/etb_test
pnpm test                               # includes packages/db's integration tests
pnpm --filter @etb/web e2e:server       # migrate, server build, Playwright: sign in, export, delete
```

CI runs the same on every pull request, plus a dependency audit, a smoke test of the production build and one of the Docker stack. Next.js sends anonymous telemetry unless told not to; Docker and CI turn it off, and `pnpm --filter @etb/web exec next telemetry disable` turns it off on your machine.

## Testing on phones

A phone opening `http://192.168.x.x:…` is **not** in a secure context, so service workers, WebGPU and `crossOriginIsolated` (SharedArrayBuffer) all fail there, and the tools that need them look broken when they aren't. Use one of these two setups.

### Android over USB (simplest, no certificates)

`localhost` always counts as secure, so forward the PC's ports to the phone:

1. On the phone: Settings → About phone → tap _Build number_ seven times, then Settings → Developer options → turn on _USB debugging_.
2. Connect the phone by USB and accept the _Allow USB debugging_ prompt.
3. On the PC, open `chrome://inspect/#devices` in Chrome, click **Port forwarding…**, add `3000` → `localhost:3000` (dev stack) and `4173` → `localhost:4173` (`pnpm preview`), tick **Enable port forwarding** and click Done. Keep that tab open.
4. On the phone, open Chrome at `http://localhost:3000` or `http://localhost:4173`. The same `chrome://inspect` page gives you DevTools for the phone's tab.

With Android platform-tools installed, `adb reverse tcp:4173 tcp:4173` does the same without Chrome on the PC.

### Any phone over Wi-Fi, including iPhone (local HTTPS with mkcert)

[mkcert](https://github.com/FiloSottile/mkcert) makes certificates your devices trust, signed by a private CA that exists only on your machine.

1. Install mkcert (`scoop install mkcert` or `choco install mkcert` on Windows, `brew install mkcert` on macOS), then run `mkcert -install` once.
2. Find the PC's LAN address (`ipconfig` on Windows, `ip addr` on Linux, System Settings → Wi-Fi → Details on macOS), for example `192.168.1.23`.
3. From the repo root: `mkcert -cert-file certs/local.pem -key-file certs/local-key.pem localhost 127.0.0.1 192.168.1.23`. (`certs/` is git-ignored. Re-run it when the address changes.)
4. Install the CA on the phone. `mkcert -CAROOT` prints the folder; copy **`rootCA.pem` only**. Never copy or share `rootCA-key.pem`.
   - Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate (names vary by maker). Chrome trusts user-installed CAs.
   - iPhone / iPad: AirDrop or mail `rootCA.pem` to the device, install it under Settings → Profile Downloaded, then turn on full trust in Settings → General → About → Certificate Trust Settings.
5. Run `pnpm preview --lan --https` and open `https://192.168.1.23:4173` on the phone. If it can't connect, allow Node through the PC's firewall for private networks.

`--lan` makes the preview reachable by everyone on your network; stop it when you're done. To undo later: remove the profile/certificate from the phone and run `mkcert -uninstall` on the PC. The Docker dev stack only listens on `localhost`, so test it over USB.

## Repository layout

```
apps/web            Next.js app (static export until M5)
apps/web/scripts    local static server for the production build
apps/worker         Python 3.12 job worker
packages/core       shared logic: env validation, logger, redaction, URL helpers
packages/ui         design system and ToolShell (M1)
packages/registry   tool registry (M1)
packages/engines    browser processing engines (M2)
packages/db         Drizzle schema and migrations (M3)
packages/api-client typed API client (M6)
config/business.ts  business numbers (credit packs, quotas, retention)
fixtures/           small, license-free test fixtures
licenses.json       machine-readable license register (docs/13-licenses.md)
```

## Environment variables

Listed with explanations in [`.env.example`](.env.example). Each process validates its env at startup and exits with a readable list of what's missing or wrong. Real secrets never go in the repo.

No domain or host is written into the code. Every absolute URL (canonical, sitemap, OG, JSON-LD, robots.txt) comes from `SITE_URL` (default `http://localhost:3000`), and model and WASM files load from `MODELS_BASE_URL` (default `/models`, i.e. `apps/web/public/models/`, which is not committed). `pnpm hosts:check` fails CI on a hard-coded one.

`pnpm models` fills `apps/web/public/models/`: ONNX Runtime Web from `node_modules`, and the Remove Background models from the sources in `models.json`, each checked against its SHA-256 in `packages/engines/src/image/rmbg/models.ts`. `build` and `dev` run it first, and files already in place are skipped. Without network the build still finishes, with a warning; `pnpm models --strict` (CI) fails instead. The 115 MB quality model is optional: without it the tool runs Light mode.

## Adding a dependency

Check the license first. Add a row to [`docs/13-licenses.md`](docs/13-licenses.md) and a matching entry to [`licenses.json`](licenses.json), then install. CI fails on unregistered dependencies, on a license that changes with an upgrade, and on any transitive package under a copyleft or unknown license.

## Go public (later)

Nothing is public until you decide to go public (the Go public step in [`docs/12-milestones.md`](docs/12-milestones.md)). CI already has a Cloudflare Pages deploy job for `main`; it's skipped while the `CLOUDFLARE_API_TOKEN` secret doesn't exist. When the time comes:

1. Buy the domain (open question 1 in [`docs/14-open-questions.md`](docs/14-open-questions.md)).
2. In Cloudflare, create a Pages project using **Direct Upload** (not "Connect to Git"), named `edittoolbelt` or anything you like, and add the domain under its _Custom domains_. Create an API token with _Account → Cloudflare Pages → Edit_.
3. In GitHub (repo → Settings → Secrets and variables → Actions), add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the variable `SITE_URL` (`https://` plus your domain), and, if the project isn't called `edittoolbelt`, the variable `CF_PAGES_PROJECT`.
4. Once models exist (M2): an R2 bucket on a `models.` subdomain, and the variable `MODELS_BASE_URL` pointing at it.

The next push to `main` then deploys, after lint, typecheck, tests and the smoke tests pass.
