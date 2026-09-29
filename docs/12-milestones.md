# 12 — Milestones

Build the skeleton properly first, with every tool listed but disabled, then switch tools on in waves. Each milestone ends with a demo on staging and **explicit sign-off** before the next begins.

Waves (from `tools/README.md`): **Wave 1** = launch set, all browser-only, zero server cost. **Wave 2** = server tools, AI tools, credits. **Wave 3** = extras.

---

## M0 — Foundations
Repo and pipeline, nothing user-facing.

- Monorepo (pnpm + Turborepo) with `apps/web`, `apps/worker`, `packages/{ui,registry,engines,core,db,api-client}`.
- TypeScript strict, ESLint, Prettier, Vitest; Python: ruff, mypy, pytest.
- `docker compose up`: Postgres, MinIO, web (hot reload), worker (hello-world job).
- Env validation (`packages/core/env.ts`), `config/business.ts` skeleton.
- CI: lint, typecheck, test on every PR. On merge to `main`: static export deployed to Cloudflare Pages (see `01` → Hosting). Buy the domain and connect it.
- Structured logging set up in web and worker (pino/structlog, shared fields, redaction).
- License register initialised (`13-licenses.md` → machine-readable `licenses.json` + CI check that every dependency is listed).

**Done when:** a fresh clone runs locally with one command; CI green; staging URL serves a placeholder page; logs appear in JSON.

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
- Security headers and CSP baseline; COOP/COEP per-route mechanism.
- Prove the CSP approach from `11` on a static tool page (static render, zero CSP violations) and the COOP/COEP navigation test from `01`.
- Measure the empty shell's initial JS against the 120 KB budget before any tool code lands; if the framework alone takes most of it, re-set the budget with sign-off now rather than discover it in M2.
- Cookieless analytics wired with the event list from `09`.
- Lighthouse CI budgets in place.

**Done when:** every tool appears on its hub as a greyed card; every placeholder page renders; Lighthouse budgets pass; axe shows no serious issues; the look is signed off in light and dark, desktop and phone, with none of the AI tells listed in `03`.

## M2 — Browser engines + first launch 🚀
First public launch with the **launch set**: 15 of the 26 Wave 1 tools, chosen for search demand and to need only 6 engines (see `tools/README.md` → Launch set). The other 11 Wave 1 tools follow in **M2b**. Getting indexed early matters more than launching complete — new pages take months to rank.

- Capability detection.
- Engines: `image-geometry`, `image-codec`, `image-ml` (client path only), `video-webcodecs`, `audio-dsp`, `text`. (`video-ffmpeg-wasm` and `media-probe` come with M2b.)
- `CanvasEditor` with crop mode and the keep/erase refine brush for P07 (other modes arrive with P01/P09/P10 in Wave 2); `Timeline` for video trim and GIF range.
- All **launch-set** tools to `live` (each with tests, unique SEO copy, FAQ); the other Wave 1 tools stay `soon`.
- Conversion pair pages only for pairs whose tool is live: the 10 image pairs, mp4/mov-to-gif, mp4/mov-to-mp3, srt↔vtt, ass-to-srt (17). Video and audio converter pairs arrive with M2b.
- "Use in another tool" handoff.
- Hybrid tools (P07, V02; V03 in M2b) ship client-only; their server paths stay off until M4/M5 (see `02`, Routing).
- Start the Paddle seller application once the site is live on its domain (Paddle's onboarding includes a website review) — don't leave it to M5.
- Background removal: BiRefNet_lite fp16 (115 MB) as the quality model + a small light-mode model for devices without WebGPU fp16 (see P07). Benchmark on the 5 fixture images, desktop and 2 real phones: IoU, time to result, download size. Models on the R2 `models.` subdomain, cached by the service worker.
- Search Console, Bing verified; sitemap live.

**Done when:** all launch-set tools pass their Playwright tests on Chrome, Safari, Firefox (desktop) and Chrome Android + Safari iOS (BrowserStack or real devices); performance budgets met; legal pages have final text (lawyer-reviewed items can wait for M5 since no money yet); site is live on the real domain.

## M2b — Rest of Wave 1 (after launch, one tool at a time)
V03 Video Converter (+ `video-ffmpeg-wasm`, video pair pages), V05 GIF to MP4, V07 Mute Video, V08 Video Info (+ `media-probe`), P04 Rotate & Flip, A01 Audio Converter (+ audio pair pages), A02 Trim Audio, A03 BPM & Key Finder, C01 Palette, C02 Colour Picker, T02 Subtitle Shift. Each goes through the checklist in `02` (`beta` first, then `live`). Also V01 precise mode "smart cut". Can run alongside M3.

**Done when:** all 26 Wave 1 tools are `live`.

## M3 — Accounts, database, admin, flags
- Better Auth (magic link + Google), account settings, data export, account deletion.
- DB schema from `04-data-model.md` (all tables, including ledger with the no-update trigger).
- Admin: dashboard (client-tool analytics + placeholders for server stats), Tools page with live status/maintenance overrides, Users, Audit log, System. TOTP for admins.
- Registry resolution from DB flags (30 s cache).
- Telegram alerts + daily digest wiring (with the rules that apply so far).

**Done when:** on the local staging stack (your PC, via Cloudflare Tunnel) you can sign in, flip any tool's status from admin and see it change within 30 s, and export/delete an account. The public site stays static until M5.

## M4 — Server job pipeline
- Upload API (multipart presign), jobs API, quote endpoint, SSE progress, cancel.
- Worker: claim/heartbeat/reaper, processor interface, ffmpeg sandboxing per `11-security.md`.
- Retention: immediate input deletion, 60-min output sweeper (also aborts stale multipart uploads), 1-day lifecycle rules incl. multipart abort + admin check.
- Free quota (per signed-in user, daily) and per-user concurrency limits; server tools ask anonymous visitors to sign in.
- Hybrid routing UI (server fallback offer with reason).
- First **server-cpu** tools from Wave 2 (e.g. VFR→CFR, large-file video compress, burn subtitles).
- `LocalGpu` backend on the 1080 Ti (pinned Pascal image, see `01` → Hosting): upscale, stems and transcription run end-to-end in local staging, so M5 only has to swap the backend and add payments.
- Admin Jobs page, job stats, failure alerts.
- Runbooks folder started.

**Done when:** a 1 GB video compresses on the server end-to-end with live progress; input is gone from storage immediately after, output gone within the hour; killing a worker mid-job requeues it; malformed-file fixtures fail cleanly.

## M5 — Credits, payments, GPU tools 💳
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
