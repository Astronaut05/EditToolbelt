# 01 — Architecture

## Shape of the system

```
                 ┌─────────────── Cloudflare (CDN, TLS, WAF, edge rate limits) ───────────────┐
 Browser / PWA ──┤                                                                            │
 Premiere panel ─┤──► apps/web (Next.js) ──► Postgres ◄── apps/worker (Python) ──► GPU backend│
                 │      pages, API, auth,     users, ledger,    ffmpeg, DSP,       (our model │
                 │      presign, SSE, admin   jobs = queue      CPU tools          containers)│
                 │            └──── presigned URLs ────► Object storage (R2) ◄──────────┘     │
                 └────────────────────────────────────────────────────────────────────────────┘
```

Three processing paths, chosen per tool in the registry (`runtime`):

| Runtime | Where | Cost to us | Examples |
|---|---|---|---|
| `client` | User's browser (Web Workers, WebCodecs, WASM, WebGPU) | ~0 | resize, convert, trim, GIF, BPM, subtitles, calculators |
| `server-cpu` | `apps/worker` CPU pool | low | large-file compress, VFR→CFR, burn subtitles, noise reduction |
| `server-gpu` | GPU backend running **our own model containers** | per GPU-second | upscale, stems, auto-subtitles, video background removal |
| `hybrid` | client by default, server fallback | depends | background removal (weak phone / huge image), video compress over client limit |

The hybrid decision lives in the tool's `route()` function (see `02-tool-framework.md`). A server fallback is always offered, never forced silently — the user sees why ("This file is too large for your browser — process on our servers for 2 credits?").

## Browser processing

- All heavy work runs in a **Web Worker**. The main thread only renders UI.
- **Video:** WebCodecs via Mediabunny first (hardware encode/decode, fastest path). ffmpeg.wasm (**LGPL build, no x264/x265**) as fallback for containers/codecs WebCodecs can't handle and for remux-only jobs. H.264/HEVC encoding in the browser therefore comes from WebCodecs (the OS/hardware encoder), not from bundled GPL encoders.
- **Images:** OffscreenCanvas for geometry; jSquash WASM codecs for AVIF/WebP/MozJPEG/OxiPNG; libheif WASM for HEIC decode, lazy-loaded as a separate file.
- **Audio:** decode to PCM in a worker (WebCodecs AudioDecoder or Web Audio `decodeAudioData`); our own DSP in TypeScript (loudness, BPM, key, silence) — no AGPL audio libraries.
- **Browser ML:** onnxruntime-web with the WebGPU execution provider, WASM fallback. Models downloaded once, stored in Cache Storage, versioned by content hash.
- **Capability detection** (`packages/engines/capabilities.ts`) runs once per session: supported WebCodecs codecs (probe with `isConfigSupported`), WebGPU, `SharedArrayBuffer`, `navigator.deviceMemory`, hardware concurrency. Tools read this to pick a path or offer server fallback.
- **Cross-origin isolation:** multi-threaded ffmpeg.wasm needs `SharedArrayBuffer`, which needs COOP/COEP headers. Apply them **only** on tool routes that need them. Checkout and any page embedding a third-party frame (Paddle overlay) must be on routes **without** COEP, or they break. Isolation is decided when a document loads, so a client-side (soft) navigation from a non-isolated page into an isolated route does **not** make it isolated: every link into a COOP/COEP route, and from one out to checkout, must be a full page load (plain `<a>` / `window.location`, not `next/link`). Playwright test: start on the home page, click through to each isolated tool, assert `crossOriginIsolated === true`.
- **Memory safety:** process large files as streams/chunks; never hold more than one decoded full-resolution frame buffer per worker; release object URLs after download.

## Server processing

### Upload
1. Client calls `POST /api/v1/uploads` with size, MIME, tool id → server validates against limits (tier, tool) → returns presigned multipart upload URLs (R2) + an `upload_id`.
2. Browser uploads directly to storage, parts in parallel (4 at a time), with resume on part failure. The app server never proxies file bytes. R2 requires every part except the last to be the **same size** (min 5 MiB): pick one part size per upload (8 MiB normally, larger for multi-GB files). Part URLs expire in 15 min, so hand them out in batches (`POST /uploads/:id/parts`) — a 2 GB upload on a slow line outlives the first batch.
3. Client calls `POST /api/v1/jobs` with `upload_id`, tool id, options. Server re-validates (magic bytes probed by the worker, see `11-security.md`), prices the job, reserves credits, inserts the job.

### Queue
- The `jobs` table **is** the queue. Workers claim with `SELECT … FOR UPDATE SKIP LOCKED` ordered by `priority DESC, created_at`. `LISTEN/NOTIFY` wakes idle workers; they also poll every 2 s as fallback.
- States: `queued → running → succeeded | failed | cancelled | expired`. Running jobs write `heartbeat_at` every 5 s.
- Reaper: `running` jobs with heartbeat older than 60 s go back to `queued` (max 2 retries, then `failed` + refund).
- Per-tool concurrency caps and timeouts come from the registry (`limits.maxConcurrent`, `limits.timeoutSec`).
- Priority: paid credits > signed-in free. (Anonymous users can't create server jobs.)
- `expired`: queued longer than 15 min (config) → cancelled + refund, user told to retry.

### Workers (`apps/worker`)
- Python 3.12. One process per CPU core, one job at a time each. Container per worker pool.
- Per job: download input to a per-job temp dir → probe (ffprobe / Pillow) and validate → run the processor → upload output → mark job → **delete temp dir and input object** (in a `finally`).
- ffmpeg/ffprobe as subprocesses with argument lists (never a shell string), wall-clock timeout, cgroup memory limit, protocol whitelist.
- Processors: `apps/worker/processors/<tool_id>.py`, common interface:
  - `estimate(meta, options) -> Estimate` — duration/cost estimate from probed metadata (used for pricing before the job starts).
  - `run(ctx) -> Result` — does the work, reports progress through `ctx.progress(pct, stage)`.

### GPU backend
- `GpuBackend` interface, two production implementations (plus `LocalGpu`, dev only: the Pascal card in M3–M4 staging, see Hosting):
  - `ServerlessGpu` (start here): our own Docker images with our chosen models, deployed to a per-second-billed serverless GPU provider. No idle cost, cold starts of seconds to tens of seconds. This satisfies "self-hosted models, not someone else's API" without a fixed monthly GPU bill.
  - `DedicatedGpu`: a rented GPU server running the **same images**, switched on when monthly GPU-seconds make it cheaper (break-even formula in `05-credits-and-payments.md`).
- The CPU worker claims GPU jobs too, forwards them to the backend, then does upload/cleanup as usual — switching backend is a config change.
- Every GPU job records `gpu_seconds`; admin shows real cost per tool.

### Progress to the client
- `GET /api/v1/jobs/:id/events` — Server-Sent Events: `queued {position}`, `progress {pct, stage}`, `succeeded {result}`, `failed {problem}`.
- Implementation: the web process polls the job row every 1 s while a stream is open. Fine for hundreds of concurrent streams; revisit with Postgres NOTIFY fan-out beyond that. Send an SSE comment (`: ping`) every 20 s — Cloudflare cuts proxied connections that stay silent for 100 s, and a queued GPU job can be quiet that long.
- Clients that can't hold SSE (panel, API users) poll `GET /api/v1/jobs/:id`.

### Retention (hard rule)
- Input objects: deleted by the worker the moment the job ends (any outcome).
- Output objects: deleted 60 min after completion by a sweeper that runs every 5 min.
- Safety net: bucket lifecycle rules `Expiration: 1 day` on every object **and** `AbortIncompleteMultipartUpload: 1 day` (R2's default abort rule is 7 days — without this, parts of abandoned uploads sit in the bucket for a week). R2 lifecycle works in whole days and removes objects typically within 24 h *after* they expire, so the backstop's worst case is ~48 h. **The sweeper is the real guarantee; lifecycle only catches sweeper failures.** The sweeper also aborts open multipart uploads older than 1 h.
- Job rows keep metadata only (tool, byte sizes, durations, resolution, status, cost). No filenames, no content.

## Hosting

### Until the project is finished: free (decided 2026-09-29)

- **Code on GitHub** (private repo). GitHub Pages is **not** used: its terms forbid using it to run an online business or SaaS, and it can't set response headers (CSP, COOP/COEP).
- **Public site, M1–M2b: Cloudflare Pages (free)**, auto-deployed from the GitHub repo on merge to `main`. This works because every launch-set and M2b tool runs in the browser: `apps/web` is built as a Next.js static export (`output: 'export'`; images pre-built as AVIF/WebP, no `next/image` optimisation), and headers (CSP, and COOP/COEP on M2b's ffmpeg.wasm routes) come from a `_headers` file (max 100 rules).
  - Limits to design for: **25 MiB max per file**, 20,000 files. ML models and big WASM files are served from an R2 bucket on a `models.` subdomain (R2's free tier, no egress fees) with CORS, immutable caching and `Cross-Origin-Resource-Policy: cross-origin` (needed once COEP routes load them).
- **Buy the domain now** (edittoolbelt.com, or .app) and point it at Cloudflare Pages. Search ranking belongs to the domain, so moving to paid hosting later is a DNS change; launching on a `*.pages.dev` address would mean starting SEO over.
- **Server parts, M3–M4: your own PC** runs the full stack with `docker compose` as private staging, reachable through a free Cloudflare Tunnel (no router ports opened). Only you and testers use it — no real users' files and no payments go through a home PC (uptime, home upload speed, and the privacy page promises EU hosting). While the public site is static, admin status flags apply to the local stack only; tool status on the public site changes by redeploy.
- **Local GPU for M3–M4: Astro's GTX 1080 Ti.** The `server-gpu` tools run on this card in local staging, so GPU jobs are tested end-to-end before renting anything. It's a Pascal card (compute capability 6.1), which sets hard rules for the dev worker image:
  - **Pin PyTorch to a build that still includes Pascal.** PyTorch removed Maxwell/Pascal from its CUDA 12.8+ wheels (starting with 2.8). CI check in the dev image: `torch.cuda.get_arch_list()` must contain `sm_61`, else fail the build.
  - **NVIDIA driver 580 is the last branch for Pascal.** Stay on it; don't pull CUDA 13 into the dev image.
  - **Run models in fp32 (or int8 where the runtime supports it on this card).** Consumer Pascal has almost no fp16 throughput, so fp16 is slower, not faster.
  - Memory: 11 GB on a 1080 Ti (8 GB if it's a plain 1080 — check Task Manager → Performance → GPU). Real-ESRGAN and BiRefNet run tiled; Demucs splits into segments; one GPU job at a time (`limits.maxConcurrent = 1` in local config).
  - This is a **dev-only** image (`apps/worker/Dockerfile.gpu-pascal`). The production GPU image targets current cards and CUDA and is built separately. Speed numbers measured on the 1080 Ti are not used for pricing.
- **Buy hosting before M5** (first public server jobs and payments) and move to the production setup below. The domain doesn't change.

### Production (from M5)

- `apps/web` and `apps/worker` as Docker containers on EU VPS (Hetzner or equivalent), behind Cloudflare.
- Postgres: managed or self-run on the same provider, daily backups + 7-day point-in-time recovery if available. DB holds no user files, so backups are small.
- Object storage: Cloudflare R2 (no egress fees — matters for download-heavy tools), EU jurisdiction bucket.
- Environments: `local` (docker compose, also the M3–M4 staging via Cloudflare Tunnel), `staging`, `production`. Identical config shape, separate DBs and buckets.
- CI (GitHub Actions): lint, typecheck, unit tests, Playwright on staging, then deploy. Migrations run as a separate step before new containers start; migrations must be backward-compatible with the previous release.
- Why EU: GDPR-friendly default for the largest paying audience; also satisfies the "adequate protection" route for keeping Uzbek users' (non-sensitive) personal data abroad (see `08-legal-and-privacy.md`).

## Configuration

- All env vars validated with Zod at boot (`packages/core/env.ts`); invalid → process exits with a clear message.
- Business numbers (credit prices, pack sizes, free quotas, file limits, retention minutes) live in `config/business.ts`. Nothing numeric-and-commercial is hard-coded in components. Admin can override tool-level numbers at runtime through `tool_flags`.

## Mobile

- The site is a **PWA**: web manifest, icons, service worker that precaches the app shell and caches engines/models on first use. Installable to the home screen; no app store.
- Android share target: the PWA registers for images/video/audio so users can "Share → EditToolbelt" from the gallery. iOS doesn't support share targets; fine.
- Tools flagged `mobile` in the registry lead the mobile home screen. Tools flagged `desktopBest` show a gentle "works best on desktop" note on small screens.

## Premiere panel

- A **UXP** panel (`apps/panel`). UXP is Premiere's current generally-available plugin system; do not build a legacy CEP extension. UXP became a standard (non-beta) feature in Premiere 2026, so the panel's minimum host version is Premiere 2026 — state it on the listing and in `/developers`.
- Thin client over the public API (`06-api.md`) plus pure calculators from `packages/core`. Never runs ML locally.
- Flow: export selected clip/audio via Premiere APIs → upload → run server tool → download result → import to a project bin named "EditToolbelt".
