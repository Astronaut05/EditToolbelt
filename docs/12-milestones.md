# 12 — Milestones

Build the skeleton properly first, with every tool listed but disabled, then switch tools on in waves. Each milestone ends with a demo and **explicit sign-off** before the next begins.

**Everything runs locally until Go public** (decided 2026-09-29): demos run on Astro's PC against the production build (`pnpm preview`) or the dev stack. No domain, no Cloudflare, no public URL until the Go public step below, which Astro triggers when ready (it must happen before M5).

Waves (from `tools/README.md`): **Wave 1** = launch set, all browser-only, zero server cost. **Wave 2** = server tools, AI tools, credits. **Wave 3** = extras.

---

## M0 — Foundations
Repo and pipeline, nothing user-facing.

- Monorepo (pnpm + Turborepo) with `apps/web`, `apps/worker`, `packages/{ui,registry,engines,core,db,api-client}`.
- TypeScript strict, ESLint, Prettier, Vitest; Python: ruff, mypy, pytest.
- `docker compose up` (`--watch` for hot reload): Postgres, S3-compatible storage (Versity S3 Gateway; MinIO dropped in M0 as AGPL, see `13`), web (hot reload), worker (hello-world job).
- Env validation (`packages/core/env.ts`), `config/business.ts` skeleton.
- CI: lint, typecheck, test and license checks on every PR. The Cloudflare Pages deploy job is in the repo but skipped until Go public (no `CLOUDFLARE_API_TOKEN`).
- No hard-coded domain or host: absolute URLs from `SITE_URL`, model/WASM files from `MODELS_BASE_URL`; CI check fails on a hard-coded one.
- Structured logging set up in web and worker (pino/structlog, shared fields, redaction).
- License register initialised (`13-licenses.md` → machine-readable `licenses.json` + CI check that every dependency is listed).

**Done when:** a fresh clone runs locally with one command; CI green; the production build (static export) serves the placeholder page locally; logs appear in JSON.

## M1 — Skeleton and design system
The whole site structure with every tool present as "coming soon".

- Visual direction: `/design-taste-frontend` design round in chat (see `03` → Visual direction) → Astro picks one → tokens.
- Design tokens, light/dark, all shared components from `03-design-system.md` in Storybook/Ladle.
- `ToolShell` with all `ui` types (form, canvas-editor shell, timeline shell, analyzer, calculator, batch) working against a dummy engine.
- Tool registry package with Zod schema + **every tool from `tools/README.md`** registered with status `soon` (name, slug, category, tagline, seo title at minimum).
- CI check: registry ↔ `tools/README.md` codes match.
- Home, category hubs, tool placeholder pages (`noindex`), search over the registry, header/footer.
- Legal page stubs (`/privacy`, `/terms`, `/refunds`, `/cookies`, `/licenses` auto-generated, `/contact`).
- SEO scaffolding: metadata from registry, JSON-LD, sitemap (live/beta only — empty for now), robots, OG image generation.
- PWA manifest + service worker (app shell precache).
- Security headers and CSP baseline; COOP/COEP per-route mechanism. The local static server (`pnpm preview`) applies the `_headers` file exactly as Cloudflare Pages will, so the proofs below run locally.
- Prove the CSP approach from `11` on a static tool page (static render, zero CSP violations) and the COOP/COEP navigation test from `01`.
- Measure the empty shell's initial JS against the 120 KB budget before any tool code lands; if the framework alone takes most of it, re-set the budget with sign-off now rather than discover it in M2.
- Cookieless analytics wired with the event list from `09`.
- Lighthouse CI budgets in place, run against the local production build.
- **Tracked: lint plugins back on ESLint 10.** Re-add Next's full preset and the React, jsx-a11y and import plugins as soon as each supports ESLint 10 (they crash on it today; ESLint 9 reached end of life on 2026-08-06, so no going back). Until then axe in Playwright is the accessibility gate. Check at the start and end of M1; carry forward if still blocked.

**Done when:** every tool appears on its hub as a greyed card; every placeholder page renders; Lighthouse budgets pass; axe shows no serious issues; the look is signed off in light and dark, desktop and phone, with none of the AI tells listed in `03`.

## M2 — Browser engines + launch set 🚀
The **launch set**, ready to go public: 15 of the 26 Wave 1 tools, chosen for search demand and to need only 6 engines (see `tools/README.md` → Launch set). The other 11 Wave 1 tools follow in **M2b**. Going public early still matters — new pages take months to rank — but it's the separate Go public step, Astro's call.

- Capability detection.
- Engines: `image-geometry`, `image-codec`, `image-ml` (client path only), `video-webcodecs`, `audio-dsp`, `text`. (`video-ffmpeg-wasm` and `media-probe` come with M2b.)
- `CanvasEditor` with crop mode and the keep/erase refine brush for P07 (other modes arrive with P01/P09/P10 in Wave 2); `Timeline` for video trim and GIF range.
- All **launch-set** tools to `live` (each with tests, unique SEO copy, FAQ); the other Wave 1 tools stay `soon`.
- Conversion pair pages only for pairs whose tool is live: the 10 image pairs, mp4/mov-to-gif, mp4/mov-to-mp3, srt↔vtt, ass-to-srt (17). Video and audio converter pairs arrive with M2b.
- "Use in another tool" handoff.
- Hybrid tools (P07, V02; V03 in M2b) ship client-only; their server paths stay off until M4/M5 (see `02`, Routing).
- Background removal: BiRefNet_lite fp16 (115 MB) as the quality model + a small light-mode model for devices without WebGPU fp16 (see P07). Benchmark on the 5 fixture images, desktop and 2 real phones: IoU, time to result, download size. Models load from `MODELS_BASE_URL` (a local path until Go public, then the R2 `models.` subdomain), cached by the service worker.

**Done when:** the launch set works locally against the production build (`next build` + static export served locally with `pnpm preview`); Playwright green on desktop browsers (Chrome, Safari/WebKit, Firefox); Lighthouse budgets met locally. Phones are checked by hand over USB or local HTTPS (README → Testing on phones).

## M2b — Rest of Wave 1 (after launch, one tool at a time)
V03 Video Converter (+ `video-ffmpeg-wasm`, video pair pages), V05 GIF to MP4, V07 Mute Video, V08 Video Info (+ `media-probe`), P04 Rotate & Flip, A01 Audio Converter (+ audio pair pages), A02 Trim Audio, A03 BPM & Key Finder, C01 Palette, C02 Colour Picker, T02 Subtitle Shift. Each goes through the checklist in `02` (`beta` first, then `live`). Also V01 precise mode "smart cut". Can run alongside M3.

**Done when:** all 26 Wave 1 tools are `live`.

## Go public (when Astro decides; required before M5)
Nothing was public before this, so there is nothing to redirect.

- Buy the domain (open question 1) and connect it to a Cloudflare Pages project.
- Set the GitHub secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and the variable `SITE_URL`; the deploy job in CI starts deploying `main`.
- R2 bucket on the `models.` subdomain for model and WASM files (CORS, immutable caching, `Cross-Origin-Resource-Policy: cross-origin`); `MODELS_BASE_URL` points there.
- Legal pages carry their final text (lawyer-reviewed items can wait for M5, since no money is taken yet).
- Search Console and Bing Webmaster Tools verified; sitemap submitted.
- Start the Paddle seller application (Paddle's onboarding reviews the live website). Don't leave it to M5.

**Done when:** the site is live on the real domain over HTTPS, deployed by CI from `main`; models load from R2; Search Console and Bing are verified with the sitemap submitted; the Paddle application is in.

## M3 — Accounts, database, admin, flags
- Better Auth (magic link + Google), account settings, data export, account deletion.
- DB schema from `04-data-model.md` (all tables, including ledger with the no-update trigger).
- Admin: dashboard (client-tool analytics + placeholders for server stats), Tools page with live status/maintenance overrides, Users, Audit log, System. TOTP for admins.
- Registry resolution from DB flags (30 s cache).
- Telegram alerts + daily digest wiring (with the rules that apply so far).

**Done when:** on the local stack (your PC) you can sign in, flip any tool's status from admin and see it change within 30 s, and export/delete an account. Any public site (after Go public) stays static until M5.

## M4 — Server job pipeline
- Upload API (multipart presign), jobs API, quote endpoint, SSE progress, cancel.
- Worker: claim/heartbeat/reaper, processor interface, ffmpeg sandboxing per `11-security.md`.
- Retention: immediate input deletion, 60-min output sweeper (also aborts stale multipart uploads), 1-day lifecycle rules incl. multipart abort + admin check. Lifecycle rules exist only on R2 (Versity S3 Gateway has none), so locally the sweeper is the only cleanup path and is what M4 tests; the lifecycle check runs against R2 once there is one, and reports "not supported" locally instead of failing.
- Free quota (per signed-in user, daily) and per-user concurrency limits; server tools ask anonymous visitors to sign in.
- Hybrid routing UI (server fallback offer with reason).
- First **server-cpu** tools from Wave 2 (e.g. VFR→CFR, large-file video compress, burn subtitles).
- `LocalGpu` backend on the 1080 Ti (pinned Pascal image, see `01` → Hosting): upscale, stems and transcription run end-to-end in the local stack, so M5 only has to swap the backend and add payments.
- Admin Jobs page, job stats, failure alerts.
- Runbooks folder started.

**Done when:** a 1 GB video compresses on the server end-to-end with live progress; input is gone from storage immediately after, output gone within the hour; killing a worker mid-job requeues it; malformed-file fixtures fail cleanly.

## M5 — Credits, payments, GPU tools 💳
- Requires Go public (Paddle only onboards a live, reviewed site).
- **Move to paid EU hosting first** (`01` → Production): web + worker + Postgres on the VPS, public site served by the Next.js server or kept on Cloudflare Pages.
- Ledger functions, reserve/capture/release, quotes, `402` flow, welcome grant after email verification.
- Paddle sandbox → live: packs, checkout on a non-COEP route, webhooks (idempotent), purchase history, refunds/chargebacks handling.
- `GpuBackend` with `ServerlessGpu`; provider chosen (open question), DPA checked. GPU tools were already built and tested on the local 1080 Ti (`LocalGpu` backend, dev only); here they move to the production image on current GPUs, and pricing is re-measured there.
- GPU tools from Wave 2 (upscale, stems, auto-subtitles/transcription, noise reduction, hi-res background removal).
- Costs page; margin alerts; ledger invariant nightly check.
- Legal: lawyer review done; Terms/Privacy/Refunds final.

**Done when:** a real purchase in live mode adds credits; a GPU job charges the quoted amount; a forced failure refunds automatically; refund webhook reverses credits; admin shows cost vs. revenue per tool.

## M6 — Public API
- OpenAPI generation, `/developers` docs page, API keys UI, scopes, per-key rate limits.
- Device-code connect flow (for the panel).
- `api-client` package used by the web app for server tools.

**Done when:** a script with only an API key can run any server tool end-to-end following the docs.

## M7 — Premiere panel
Moved ahead of the rest of Wave 2 (decided 2026-09-29): it only needs the API (M6) and the GPU tools already live from M5, and Adobe's plugin marketplace is a channel competitors mostly aren't in.

- UXP panel with Bolt UXP or plain UXP + React, connect flow, tool list from `GET /tools?surface=panel`, export clip → run → import to bin, balance and buy link.
- Calculators from `packages/core` in the panel.
- Packaging for Adobe Exchange.

**Done when:** from inside Premiere, a selected clip gets auto-subtitles and the SRT lands in the project bin; stems land as four audio files.

## M8 — Remaining Wave 2 + mobile polish
- Rest of Wave 2 tools.
- Mobile: bottom sheets, thumb-reach actions, Android share target, install prompt UX, `desktopBest` notes.
- Russian localisation (if decided) with translated SEO fields.

**Done when:** Wave 2 fully live; mobile Lighthouse and usability pass on real phones.

## Then — Wave 3
Tools added one by one, each with the standard checklist in `02-tool-framework.md`.

---

## Working in parallel (optional)

After **M4**, two Claude Code sessions can work at once **only on separate tool folders** (e.g. one on `tools/photo.md` tools, one on `tools/audio.md` tools). Shared packages (`ui`, `registry` schema, `engines` core, `db`, API) are touched by one session at a time. Each session works on its own branch; merge often.
