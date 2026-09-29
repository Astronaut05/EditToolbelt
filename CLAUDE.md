# EditToolbelt — project brief for Claude Code

A web service of fast, no-install utilities for video, photo and audio editors. Every tool is its own page, built on one shared shell. Small jobs are free and run in the user's browser; heavy AI jobs run on our servers and cost credits. Later: an installable mobile web app and a Premiere panel on the same backend.

Product name: **EditToolbelt** — "the editor's toolbelt". Domain, logo and accent colour are still open (see `docs/14-open-questions.md`).

## How to use these docs

This file is read every session. Everything else is read **only when the current task needs it**; don't load the whole `docs/` folder.

| When you are… | Read |
|---|---|
| Starting any milestone | `docs/12-milestones.md` (find the current one) |
| Touching infra, services, deploy, storage, queue | `docs/01-architecture.md` |
| Building or changing any tool, tool page, or the registry | `docs/02-tool-framework.md` + the one relevant file in `tools/` |
| Building UI components, layout, theme | `docs/03-design-system.md` |
| Database schema or migrations | `docs/04-data-model.md` |
| Credits, pricing, payments, free quota | `docs/05-credits-and-payments.md` |
| Public API, API keys, Premiere panel backend | `docs/06-api.md` |
| Admin panel, logs, alerts, monitoring | `docs/07-admin-and-logging.md` |
| Privacy, cookies, terms, anything legal | `docs/08-legal-and-privacy.md` |
| Page metadata, URLs, sitemap, analytics events | `docs/09-seo-and-growth.md` |
| Speed budgets, loading, caching | `docs/10-performance.md` |
| Uploads, file parsing, ffmpeg, auth, secrets | `docs/11-security.md` |
| Adding any dependency or ML model | `docs/13-licenses.md` — **check before installing** |

Tool specs are split by category: `tools/photo.md`, `tools/video.md`, `tools/audio.md`, `tools/color.md`, `tools/subtitles-and-time.md`, `tools/utility.md`. The master list with every tool's ID, wave and status is `tools/README.md`.

## Non-negotiable rules

1. **Browser first.** If a tool can run in the browser at acceptable quality, it runs in the browser. Server processing is the exception and must be justified in the tool spec. This is the speed promise and the cost model.
2. **One shell, no one-offs.** Every tool page is rendered by the shared `ToolShell` from its registry entry. A tool never ships its own layout, upload box, progress bar or download button.
3. **The registry is the source of truth.** Tool name, slug, status, runtime, cost, limits, surfaces and SEO metadata live in the tool registry. Pages, sitemap, admin, API `/tools` and the hub grids all read from it. Nothing is hard-coded twice.
4. **User files are never kept.** Server-side inputs are deleted as soon as the job finishes, outputs within 1 hour by the retention sweeper — the sweeper is the guarantee; storage lifecycle rules are only a backstop (R2 works in whole days and deletes up to ~24 h late, so ≤ 48 h worst case). Never log filenames or file contents. Never use user files for training. See `docs/08-legal-and-privacy.md`.
5. **Credits are an append-only ledger.** Never update a balance without a matching ledger row in the same transaction. Failed jobs refund automatically.
6. **No GPL/AGPL code shipped to the browser, no AGPL anywhere, no non-commercial model weights anywhere.** Check `docs/13-licenses.md` before adding any package or model. If a license is unclear, stop and ask.
7. **No tracking cookies.** Only strictly necessary cookies. Analytics are cookieless and contain no personal data.
8. **Coming-soon tools stay visible.** Tools with status `soon` show on hub pages as greyed-out cards and have a `noindex` placeholder page. Admin can flip any tool's status without a deploy.
9. **Accessible by default.** WCAG 2.2 AA: keyboard operable, visible focus, labels, contrast, reduced-motion respected.
10. **Milestone gates.** Finish one milestone, show the result, and wait for sign-off before starting the next. Don't build ahead.

## Stack (decided)

- Monorepo: pnpm workspaces + Turborepo, TypeScript strict everywhere on the JS side.
- `apps/web`: Next.js (current stable, App Router), React, Tailwind CSS. Server Components for pages, client components for tools.
- `apps/worker`: Python 3.12 job workers (ffmpeg, ML models). Talks to Postgres and object storage only.
- `apps/panel`: Premiere UXP panel (milestone 7).
- `packages/ui` design system · `packages/registry` tool registry · `packages/engines` browser processing engines · `packages/core` pure logic shared by web and panel (calculators, subtitle parsing, timecode) · `packages/db` Drizzle schema + migrations · `packages/api-client` typed client for web and panel.
- Postgres (also the job queue). S3-compatible object storage (Cloudflare R2 in production, Versity S3 Gateway locally; MinIO is AGPL, see `docs/13-licenses.md`). Cloudflare in front for CDN, TLS and edge rate limiting.
- Auth: Better Auth — email magic link + Google. Payments: Paddle (merchant of record) behind a `PaymentProvider` interface.
- Local dev: `docker compose up --watch` gives Postgres, S3 storage, worker, and web with hot reload.

## Commands

- `docker compose up --watch`: the whole local stack (web on :3000, worker, Postgres, storage).
- `pnpm check`: format, lint, typecheck, unit tests and license check for the JS side. `pnpm worker:check`: the same for `apps/worker` (ruff, mypy, pytest, licenses).
- Adding a dependency: row in `docs/13-licenses.md` + entry in `licenses.json` first, or CI fails.

## Conventions

- Zod schemas at every boundary (API input, registry entries, env vars, job payloads).
- Errors to clients use RFC 9457 `application/problem+json`.
- Every tool has unit tests for its pure logic and one Playwright test that drops a fixture file and checks the output.
- Fixtures live in `fixtures/` (small, license-free, generated where possible).
- Commit messages: conventional commits. One milestone per branch; PR describes what's done vs. the milestone checklist.
- UI copy: English, plain, short. Numbers and units always visible (px, MB, LUFS, fps).
- **Design source: Astro's `/design-taste-frontend` skill.** It runs in claude.ai chat, not in Claude Code. Its design round sets the visual direction (M1) and makes marketing graphics; its taste rules are copied into `docs/03-design-system.md` → "Taste rules", and that section is what you follow when building UI. EditToolbelt is not Uzcosmos work: never use the Uzcosmos logo or the TT Hoves font here.
