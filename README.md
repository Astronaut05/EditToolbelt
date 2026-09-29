# EditToolbelt

Fast, no-install utilities for video, photo and audio editors: "the editor's toolbelt". Small jobs run free in the browser; heavy AI jobs run on our servers for credits.

The spec lives in this repo: start with [`CLAUDE.md`](CLAUDE.md), then [`docs/`](docs/) and [`tools/`](tools/). Milestones and their status: [`docs/12-milestones.md`](docs/12-milestones.md). Decisions made while building: [`CHANGES.md`](CHANGES.md).

## Run it locally

You need Docker with Compose 2.22 or newer (Docker Desktop is fine). Then, from a fresh clone:

```sh
docker compose up --watch
```

| Service  | Where                 | What                                                                             |
| -------- | --------------------- | -------------------------------------------------------------------------------- |
| web      | http://localhost:3000 | Next.js dev server. Edits under `apps/web` and `packages` hot-reload.            |
| worker   | (no port)             | Python worker. Runs a hello-world job against Postgres and storage, then idles.  |
| postgres | localhost:5432        | Postgres 18, user / password / db: `etb` / `etb-local-only` / `etb`              |
| storage  | http://localhost:7070 | S3-compatible storage (Versity S3 Gateway), key `etb-local` / `etb-local-secret` |

`--watch` syncs file changes into the containers (hot reload for web, rebuild for the worker). Plain `docker compose up` runs the same stack without it. Host ports can be moved with `ETB_WEB_PORT`, `ETB_POSTGRES_PORT`, `ETB_STORAGE_PORT`. All credentials above are local placeholders.

Every service logs one JSON object per line (`ts`, `level`, `service`, `env`, `version`, `event`, …), e.g. `docker compose logs worker`.

Everything runs on this machine until the Go public step (see below): no domain, no Cloudflare.

## The production build, locally

Milestones are signed off against the real production build, served the way Cloudflare Pages will serve it later:

```sh
pnpm preview        # next build (static export), then http://localhost:4173
```

The server is `apps/web/scripts/serve.ts` (Node only, no dependencies). `pnpm preview --lan --https` serves it to phones on your Wi-Fi; see [Testing on phones](#testing-on-phones).

## Checks

Outside Docker you need Node 24 (22.18+ works) with Corepack, and [uv](https://docs.astral.sh/uv/) for the worker.

```sh
corepack enable
pnpm install
pnpm check          # format, lint, typecheck, unit tests, license and host checks (JS side)
pnpm worker:check   # ruff, mypy, pytest, license check (apps/worker)
pnpm build          # static export of apps/web into apps/web/out
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

## Adding a dependency

Check the license first. Add a row to [`docs/13-licenses.md`](docs/13-licenses.md) and a matching entry to [`licenses.json`](licenses.json), then install. CI fails on unregistered dependencies, on a license that changes with an upgrade, and on any transitive package under a copyleft or unknown license.

## Go public (later)

Nothing is public until you decide to go public (the Go public step in [`docs/12-milestones.md`](docs/12-milestones.md)). CI already has a Cloudflare Pages deploy job for `main`; it's skipped while the `CLOUDFLARE_API_TOKEN` secret doesn't exist. When the time comes:

1. Buy the domain (open question 1 in [`docs/14-open-questions.md`](docs/14-open-questions.md)).
2. In Cloudflare, create a Pages project using **Direct Upload** (not "Connect to Git"), named `edittoolbelt` or anything you like, and add the domain under its _Custom domains_. Create an API token with _Account → Cloudflare Pages → Edit_.
3. In GitHub (repo → Settings → Secrets and variables → Actions), add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the variable `SITE_URL` (`https://` plus your domain), and, if the project isn't called `edittoolbelt`, the variable `CF_PAGES_PROJECT`.
4. Once models exist (M2): an R2 bucket on a `models.` subdomain, and the variable `MODELS_BASE_URL` pointing at it.

The next push to `main` then deploys, after lint, typecheck, tests and the smoke tests pass.
