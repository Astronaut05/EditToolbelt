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
2. Browser uploads directly to storage, parts in parallel (4 at a time), with resume on part failure. The app server never proxies file bytes. R2 requires every part except the last to be the **same size** (min 5 MiB): pick one part size per upload (8 MiB normally, larger for multi-GB files). Part URLs expire in 15 min, so hand them out in batches (`POST /uploads/:id/parts`) — a 2 GB upload on a slow line outlives the first batch. The bucket's CORS rules allow our origin for `PUT` and `GET` and **expose `ETag`**: the browser reads each part's ETag to complete the upload.
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
- `GpuBackend` interface, two production implementations (plus `LocalGpu`, dev only: the Pascal card in the local stack, see Hosting):
  - `ServerlessGpu` (start here, on **Modal**, decided 2026-10-01): our own images with our chosen models, deployed to a per-second-billed serverless GPU provider. No idle cost, cold starts of seconds to tens of seconds. This satisfies "self-hosted models, not someone else's API" without a fixed monthly GPU bill. The worker calls out and polls; inputs and outputs move through R2 presigned URLs.
  - `DedicatedGpu`: a rented GPU server running the **same images**, switched on when monthly GPU-seconds make it cheaper (break-even formula in `05-credits-and-payments.md`).
- The CPU worker claims GPU jobs too, forwards them to the backend, then does upload/cleanup as usual — switching backend is a config change.
- Every GPU job records `gpu_seconds`; admin shows real cost per tool.

**What's built (M5, 2026-10-02):**
- **The Modal app** `edittoolbelt-gpu` (`apps/worker/src/etb_worker/gpu/modal_app.py`), deployed by CI on merges to `main` (`.github/workflows/modal.yml`). One function per tool:

  | Function | Tools | GPU | Model | Timeout · idle window · containers |
  |---|---|---|---|---|
  | `upscale_image` | P08 | T4 | Real-ESRGAN `realesr-general-x4v3` (with its denoise twin, blended by strength) or `RealESRGAN_x4plus_anime_6B`, 512 px tiles with a 24 px margin, fp16 | 15 min · 10 s · 2 |
  | `transcribe` | A12, V17 | L4 | Whisper `large-v3` (OpenAI's `openai-whisper`), fp16, word timing on | 65 min · 30 s · 2 |

  T4 for the upscaler: small networks in tiles, where most of a call is reading, tiling and writing, so the cheaper second wins. L4 for Whisper: a 1.5 B parameter decoder runs about twice as fast as on a T4 for 1.35× the price. Every function asks for 2 CPU cores and 8 GiB, which `config/business.ts` prices with the GPU.
- **Weights are pinned.** `gpu/pins.json` holds each file's URL, SHA-256 and licence; Modal downloads them while it builds the image and `gpu/weights.py` fails the build on a mismatch. Nothing is downloaded when a function runs. CI checks every pin against its source before deploying (no token needed).
- **A call:** presigned GET for the input (or a `data:` URL, for smoke tests), presigned PUT for the output, both valid for the job's time limit plus 15 min; a temp dir that is always removed; nothing printed about the content. It returns only numbers and notes: `gpu_seconds` (measured inside, from the call's start, so a cold model load counts), whether it was cold, the idle window, the output's size. Failures it can word come back as a code and a sentence (`TOO_LARGE`, `DECODE_FAILED`).
- **`ServerlessGpu` in the worker** (`gpu/backend.py`, `GPU_BACKEND=modal`): `Function.from_name(app, fn).spawn(...)`, then `get(timeout=2)` in a loop; between polls the elapsed time becomes progress against the processor's estimate (the heartbeat carries it), and the call is cancelled when the job is cancelled, the worker stops, or the job's time is up. `LocalGpu` (`local`) only says it isn't set up; unset, GPU jobs fail at once with their credits back. `modal` without a token starts the worker with its GPU tools off.
- **Processors** (`processors/upscale_image.py`, `processors/transcribe.py`, shared step `processors/remote.py`): they record the output key on the job before the call (so a dead worker's output is still swept), call the backend, and finish like any job: input deleted at once, output after 60 min. Transcription writes Whisper's JSON to storage; the worker reads it back, deletes it at once and writes SRT, VTT, ASS, TXT or JSON (`captions.py`).
- **Metering:** each call's GPU seconds and cost land on the job whatever happened (`05` → GPU costs and the daily budget); the daily budget stops new GPU jobs.
- **Smoke test:** `python -m etb_worker.gpu.check --smoke` calls each function once on a tiny input it makes itself (Actions → Modal → Run workflow → smoke).
- **Not yet:** P07's hi-res server path (BiRefNet), A09 Stem Splitter (parked: Demucs's weights licence), `LocalGpu`, `DedicatedGpu`. A worker killed outright (not stopped) leaves its GPU call running until the function's timeout.

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

### Production, private until Go public (decided 2026-10-01)

The site runs at its real domain from now on, behind Cloudflare Access, so only Astro can open it. Go public (below) takes Access off; nothing else about hosting changes then.

```
 Astro ──► Cloudflare (DNS, TLS, Access) ──► Railway, EU West (Amsterdam)
                                               ├─ web       Next.js server build (pages, API, auth, admin)
                                               ├─ worker    apps/worker (queue, ffmpeg, CPU tools) ──► Modal (GPU, per second)
                                               └─ Postgres  18, private network only
 browser ◄── presigned URLs ──► Cloudflare R2 (EU jurisdiction) ◄── worker, Modal
```

- **Railway**, region EU West (Amsterdam), Hobby plan with a hard usage limit of $30 a month (Workspace → Usage). Three services from this repo:
  - **web**: the Next.js server build (`ETB_TARGET=server`), serving every page, the API and the admin. It sets the same security headers, CSP and COOP/COEP as the `_headers` file the static export uses, and CI checks them on the live site.
  - **worker**: `apps/worker`. It reaches Postgres over Railway's private network and storage over HTTPS. Its disk holds one job's input and output at a time per job slot, sized against the largest upload allowed (`config/business.ts`), with a volume where the container's own disk is too small.
  - **Postgres 18** (UUIDv7 ids need 18, see `04`): Railway's template if it's 18, else the official `postgres:18` image with a volume. Private network only, with no public TCP proxy. One-off commands (`pnpm admin:promote`) run inside the web service with `railway ssh`.
  - **Deploys:** Railway builds and deploys every merge to `main` once CI has passed on it. Migrations run as the web service's pre-deploy command, so a failed migration stops the deploy, and migrations stay backward-compatible with the release before. The health check is `/readyz` (database and storage).
  - **After each deploy** CI waits for the new commit to answer, then smoke-tests the live site through Access with a service token: pages, headers, `/readyz`, sign-in, and the API.
  - Only the custom domain is public. The web service accepts a request only when it carries a valid Cloudflare Access token (`Cf-Access-Jwt-Assertion`, checked against the team's keys and the app's audience), so Railway's own hostname and direct hits on Railway's edge can't bypass Access. The health check, which Railway sends on its private network, is the one exception.
- **Cloudflare:**
  - DNS for edittoolbelt.com, proxied, SSL mode Full (strict). `www` redirects to the apex.
  - **Access** (Zero Trust, free plan): one self-hosted application for edittoolbelt.com and www. One policy allows Astro's email only, with a one-time PIN by email or Google. A Service Auth policy lets CI's service token through. Paths that payment providers must reach (their webhooks) get a bypass only when payments are turned on (`docs/runbooks/turn-on-payments.md`).
  - **R2:** the bucket `edittoolbelt-files` in the EU jurisdiction. Lifecycle: every object deleted after 1 day, multipart uploads aborted after 1 day (see Retention). CORS: the site's origin may `GET`, `PUT` and `HEAD`, and `ETag` is exposed. The app's key is an R2 token limited to this bucket's objects.
  - Models and WASM files are served by the web service itself (`MODELS_BASE_URL=/models`), the same origin as the pages, so Access covers them and COEP needs no extra headers.
- **GPU: Modal**, serverless and billed per second, scaling to zero, with a $20 monthly spend limit. This is `ServerlessGpu` (see GPU backend):
  - The worker calls Modal's functions and polls them. Modal never calls us.
  - Inputs and outputs move through R2 presigned URLs, and nothing is kept on Modal.
  - L4 by default, T4 where it's enough.
  - A GitHub Action deploys the Modal app on every merge to `main`.
- **Sign-in and alert email:** an SMTP provider with a free tier (`docs/DECISIONS.md`), sending from the domain with SPF and DKIM.
- **Environments:** `local` (docker compose) and `production`. There is no staging while one person uses the site: PRs are tested in CI against real Postgres and S3-compatible storage, and production is checked after each deploy. Add staging (a second Railway environment and bucket) before Go public if needed.
- **Why Railway, not a VPS:** deploys from Git with config in the repo, a private network, a hard monthly cap, and no servers to patch. The containers are plain Dockerfiles, so a VPS later is new hosting and variables, not code.
- **Why EU:** GDPR-friendly default for the largest paying audience; also satisfies the "adequate protection" route for keeping Uzbek users' (non-sensitive) personal data abroad (see `08-legal-and-privacy.md`).

### Local development

- **Code on GitHub.** CI runs lint, typecheck, tests and license checks on every PR. GitHub Pages is **not** used: its terms forbid using it to run an online business or SaaS, and it can't set response headers (CSP, COOP/COEP).
- `docker compose up --watch` runs the whole stack: web, worker, Postgres, S3-compatible storage (Versity S3 Gateway) and Mailpit. `pnpm preview` builds the static export (`output: 'export'`; images pre-built as AVIF/WebP, no `next/image` optimisation) and serves it with the headers from the `_headers` file (CSP, and COOP/COEP on the routes that need them).
- **No host is hard-coded.** Every absolute URL (canonical, sitemap, OG, JSON-LD, robots.txt) is built from `SITE_URL` (default `http://localhost:3000`). Model and WASM files load from `MODELS_BASE_URL` (default `/models`, a local path under `apps/web/public/models/`, not committed). CI fails on a hard-coded domain or host in code (`pnpm hosts:check`); workflows read the domain from the `SITE_URL` repository variable.
- **Phones** reach the PC over USB (Android, port forwarding: `localhost` is a secure context) or over Wi-Fi with local HTTPS (mkcert). Plain `http://192.168.x.x` is not a secure context, so service workers, WebGPU and `crossOriginIsolated` all fail there. See README → Testing on phones. The private live site works on phones too, after the Access login.

### Go public (when Astro decides)

- **Take Access off** (or narrow it to `/admin`), and turn on the public parts that wait for it: Search Console and Bing verification, sitemap submission, and Paddle's live onboarding (Paddle reviews the live website).
- **Revisit Cloudflare Pages** for the static pages. The static export and its dormant deploy job (`CLOUDFLARE_API_TOKEN`, Pages' 25 MiB per-file and 20,000-file limits, models from an R2 `models.` subdomain) are still in the repo. The alternative is to keep serving everything from Railway behind Cloudflare's cache.
- Legal pages carry their final text before money is taken.

### Local GPU (development only)

- **Local GPU for M3–M4: Astro's GTX 1080 Ti.** The `server-gpu` tools run on this card in the local stack, so GPU jobs are tested end-to-end before renting anything. It's a Pascal card (compute capability 6.1), which sets hard rules for the dev worker image:
  - **Pin PyTorch to a build that still includes Pascal.** PyTorch removed Maxwell/Pascal from its CUDA 12.8+ wheels (starting with 2.8). CI check in the dev image: `torch.cuda.get_arch_list()` must contain `sm_61`, else fail the build.
  - **NVIDIA driver 580 is the last branch for Pascal.** Stay on it; don't pull CUDA 13 into the dev image.
  - **Run models in fp32 (or int8 where the runtime supports it on this card).** Consumer Pascal has almost no fp16 throughput, so fp16 is slower, not faster.
  - Memory: 11 GB on a 1080 Ti (8 GB if it's a plain 1080 — check Task Manager → Performance → GPU). Real-ESRGAN and BiRefNet run tiled; Demucs splits into segments; one GPU job at a time (`limits.maxConcurrent = 1` in local config).
  - This is a **dev-only** image (`apps/worker/Dockerfile.gpu-pascal`). The production GPU image targets current cards and CUDA and is built separately. Speed numbers measured on the 1080 Ti are not used for pricing.
- `LocalGpu` is for development only; production GPU jobs run on Modal.

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
