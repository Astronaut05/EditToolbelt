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

## Checks

Outside Docker you need Node 24 (22.18+ works) with Corepack, and [uv](https://docs.astral.sh/uv/) for the worker.

```sh
corepack enable
pnpm install
pnpm check          # format, lint, typecheck, unit tests, license check (JS side)
pnpm worker:check   # ruff, mypy, pytest, license check (apps/worker)
pnpm build          # static export of apps/web into apps/web/out
```

CI runs the same on every pull request, plus a dependency audit and a smoke test of the Docker stack.

## Repository layout

```
apps/web            Next.js app (static export until M5)
apps/worker         Python 3.12 job worker
packages/core       shared logic: env validation, logger, redaction
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

## Adding a dependency

Check the license first. Add a row to [`docs/13-licenses.md`](docs/13-licenses.md) and a matching entry to [`licenses.json`](licenses.json), then install. CI fails on unregistered dependencies, on a license that changes with an upgrade, and on any transitive package under a copyleft or unknown license.

## Deploy

On every push to `main`, CI builds the static export and uploads it to Cloudflare Pages, but only after lint, typecheck, tests and the stack smoke test pass. Until it's configured, the deploy job skips with a warning.

One-time setup:

1. **Cloudflare Pages project.** In Cloudflare, create a Pages project named `edittoolbelt` using **Direct Upload** (not "Connect to Git"), or run `npx wrangler pages project create edittoolbelt --production-branch=main`.
2. **API token.** Create a Cloudflare API token with the permission _Account → Cloudflare Pages → Edit_.
3. **GitHub secrets** (repo → Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. **Optional GitHub variables:** `CF_PAGES_PROJECT` if the project isn't called `edittoolbelt`; `SITE_URL` once the domain is live (defaults to `https://<project>.pages.dev`).
5. **Domain.** Buy the domain (open question 1 in [`docs/14-open-questions.md`](docs/14-open-questions.md)), add it under the Pages project's _Custom domains_, then set `SITE_URL` to it.
