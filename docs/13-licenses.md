# 13 — License register

Every third-party library, model, font and icon set goes here **before** it's installed. CI reads the machine-readable copy (`licenses.json`, created in M0) and fails if a dependency isn't listed. `/licenses` on the site is generated from it.

**Keep both in step.** Add the row here *and* the entry in `licenses.json` (its `label` must appear in a row of this file). `pnpm licenses:check` (npm packages including transitive ones, GitHub Actions, Docker images) and `pnpm worker:check` (Python) enforce it: an unlisted dependency, a 🔍 entry that got installed, a license that changed on upgrade, or a transitive package under a copyleft/unknown license all fail CI. Transitive packages under an `allowed` license (see `policy` in `licenses.json`) need no row.

## Rules

| Where it runs | Allowed | Not allowed |
|---|---|---|
| **Shipped to the browser** (JS, WASM, models) | MIT, BSD, ISC, Apache-2.0, MPL-2.0, Zlib, OFL (fonts), CC0/CC-BY (with attribution), LGPL **only** as a separately loaded file we can swap (with source offer on `/licenses`) | GPL, AGPL, non-commercial (CC BY-NC etc.), "research only", unknown |
| **Server only** (worker containers) | All of the above + GPL (we don't distribute server code) | AGPL, non-commercial, research-only, unknown |
| **Model weights** (anywhere) | Explicitly commercial-use licenses (MIT, Apache-2.0, BSD, CC-BY, OpenRAIL-M where terms fit) | Non-commercial, research-only, "contact us", unclear |

- Code license and **weights license are separate** — a MIT repo can ship non-commercial weights. Check both.
- ffmpeg: server builds may be GPL; **no `--enable-nonfree`** builds anywhere (not redistributable, legally murky). Browser ffmpeg.wasm must be built LGPL-only (`--disable-gpl`, no x264/x265).
- Record the exact version/commit and where you read the license (URL) for each entry.
- If unsure: don't install, add to "Pending review" below, ask.

Status legend: ✅ approved · ⚠️ approved with condition · ❌ banned · 🔍 verify license text at install time (listed from research, confirm the current license before use)

## Platform and app

| Package | Use | License | Status |
|---|---|---|---|
| Next.js, React | web app | MIT | ✅ |
| Tailwind CSS (`tailwindcss`, `@tailwindcss/postcss`) | styling | MIT | ✅ 4.3.3, checked 2026-09-30 |
| Zod | validation | MIT | ✅ |
| Drizzle ORM | database schema, queries and migrations (`packages/db`) | Apache-2.0 | ✅ 0.45.3, checked 2026-09-30 |
| node-postgres (`pg`) | Postgres driver for the web server and scripts | MIT | ✅ 8.23.0, checked 2026-09-30 |
| Better Auth | accounts: magic-link and Google sign-in, sessions, TOTP for admins (server only; its telemetry is switched off) | MIT | ✅ 1.7.6, checked 2026-09-30 |
| Nodemailer | sends sign-in emails over SMTP (Mailpit on the local stack) | MIT-0 | ✅ 10.0.12, checked 2026-09-30 |
| aws4fetch | signs S3 requests and presigns upload and download URLs for object storage (server only; no dependencies) | MIT | ✅ 1.0.20, checked 2026-09-30 |
| pino | logging | MIT | ✅ |
| structlog | Python logging | MIT / Apache-2.0 | ✅ |
| Modal client (`modal`) | the worker calls the GPU functions on Modal; CI deploys the Modal app. Its own dependencies are permissive (aiohttp, grpclib, protobuf, rich, synchronicity …) | Apache-2.0 | ✅ 1.6.0, checked 2026-10-01 |
| next-intl | i18n | MIT | 🔍 |
| Lucide | icons | ISC | ✅ lucide-react 1.49.0, checked 2026-09-30 |
| Onest (variable) + IBM Plex Mono | UI and numeric fonts, self-hosted | OFL-1.1 | ✅ |
| Fontsource packages for Onest and IBM Plex Mono (`@fontsource-variable/onest`, `@fontsource/onest`, `@fontsource/ibm-plex-mono`) | where the self-hosted font files come from (copied into the build, subset by `unicode-range`); static Onest weights for the build-time OG images | OFL-1.1 | ✅ 5.3.1 / 5.3.1 / 5.3.0, checked 2026-09-29 |
| PostCSS | CSS build pipeline for Tailwind (build time only) | MIT | ✅ checked 2026-09-30 |
| Umami (self-hosted) | cookieless analytics | MIT | 🔍 |
| Sentry SDKs / GlitchTip | error tracking | MIT / MIT | 🔍 |
| Paddle.js | checkout | vendor terms | ⚠️ checkout route only |
| Pillow | server image probe/ops; reads and writes images in the Upscale Image GPU image | HPND (MIT-style) | ✅ 12.3.0 in the GPU image, checked 2026-10-02 |

## Browser processing

| Package | Use | License | Status |
|---|---|---|---|
| Mediabunny | WebCodecs mux/demux, fast video ops | MPL-2.0 | ✅ checked 2026-09-30 (1.60.0): runtime dependencies are type packages only; it drives the browser's WebCodecs and ships no codecs |
| @ffmpeg/ffmpeg + our own core build | wasm fallback | wrapper MIT; core LGPL when built with `--disable-gpl` | ⚠️ LGPL build only, separate file, source offer |
| jSquash (avif, webp, jpeg, png, oxipng, resize) | image codecs | Apache-2.0 (underlying codecs BSD/IJG/MIT) | ✅ checked 2026-09-30 from the installed codec licence files: MozJPEG/libjpeg-turbo IJG + BSD-3-Clause, libwebp BSD-3-Clause, libavif + libaom BSD-2-Clause (AOM royalty-free patent licence), OxiPNG MIT. Single-threaded builds only |
| libheif-js (+ libde265) | HEIC decode | LGPL-3.0 | ⚠️ separate lazy-loaded file, source offer; HEVC patent question → open questions |
| onnxruntime-web | browser ML | MIT | ✅ |
| mediainfo.js | media info / VFR check | BSD-2-Clause | 🔍 |
| web-audio-beat-detector (or in-house) | BPM | MIT | 🔍 (in-house preferred) |
| Signalsmith Stretch (`signalsmith-stretch`, WASM/AudioWorklet) | tempo/pitch (A08, V13) | MIT | 🔍 — preferred over SoundTouch: permissive licence, no source-offer duty |
| SoundTouch (JS/WASM port) | tempo/pitch fallback | LGPL-2.1 | ⚠️ only if Signalsmith falls short; separate file, source offer |
| qrcode (npm) | QR generation (U01): browser entry only, it builds the matrix and we render SVG/PNG | MIT | ✅ checked 2026-09-30 (1.5.4) |
| fflate | ZIP of batch outputs ("Download all") and of Split Image's tiles, in the image worker | MIT | ✅ checked 2026-09-30 (0.8.3) |
| `@mediabunny/mp3-encoder` (preferred) or lamejs | MP3 encoding — WebCodecs has no MP3 encoder | package MPL-2.0; LAME inside is LGPL | ⚠️ checked 2026-09-30 (1.60.0): the LAME WASM is compiled into the package's own worker, imported only when MP3 is picked, so it ships as a separate lazy-loaded file; source offer on `/licenses`. MP3 patents have expired |
| `@mediabunny/flac-encoder` | FLAC encoding — no browser encodes FLAC | package MPL-2.0; libFLAC inside is BSD-3-Clause | ✅ checked 2026-09-30 (1.60.0) |
| `@mediabunny/aac-encoder` | AAC-LC encoding where the browser's WebCodecs can't (feature-detect first) | package MPL-2.0; WASM build of FFmpeg's AAC encoder (LGPL) | ⚠️ separate lazy-loaded file, source offer; AAC patent question → open question 10 |
| pdf-lib | images to PDF (Wave 3) | MIT | 🔍 |
| vtracer (WASM) | image to SVG (Wave 3) | MIT | 🔍 |
| jsQR | QR decode — **tests only**, not shipped | Apache-2.0 | ✅ checked 2026-09-30 (1.4.0) |

## Models

| Model | Use | Code license | Weights license | Status |
|---|---|---|---|---|
| BiRefNet (general / lite / HR / dynamic / portrait) | background removal | MIT | MIT | ✅ checked 2026-09-29 — primary candidate. Browser: `onnx-community/BiRefNet_lite-ONNX` is 224 MB fp32 / **115 MB fp16** — fits the 120 MB budget in `10` (fp16, WebGPU only). Server: BiRefNet general (1024) or HR (2048) |
| BEN2 base (PramaLLC) | background removal | MIT | MIT (base model only — their "full" model is a paid API) | 🔍 — server candidate, 94.6 M params |
| InSPyReNet (`transparent-background`) | background removal | MIT | 🔍 — the MIT LICENSE covers the code; the checkpoint licence isn't stated there | 🔍 — only after the weights licence is confirmed |
| ISNet (DIS) general-use | background removal | Apache-2.0 | Apache-2.0 | 🔍 — candidate |
| U²-Net / u2netp | background removal, Light mode (P07) | Apache-2.0 | Apache-2.0 | ✅ checked 2026-09-30: the weights are published in the authors' repo (xuebinqin/U-2-Net) under its Apache-2.0 licence; the ONNX export is the one `rembg` (MIT) ships as a release asset, pinned by SHA-256 in `packages/engines/src/image/rmbg/models.ts`. 4.6 MB, WASM |
| Real-ESRGAN | image upscale (P08), on our GPU servers only | BSD-3-Clause | BSD-3-Clause | ✅ checked 2026-10-02 from [the LICENSE](https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE) ("Copyright (c) 2021, Xintao Wang") and the README. The weights we use are the repository's own release assets, published by the author with the code (`RealESRGAN_x4plus.pth` v0.1.0, `RealESRGAN_x4plus_anime_6B.pth` v0.2.2.4, `realesr-general-x4v3.pth` and `realesr-general-wdn-x4v3.pth` v0.2.5.0); no separate weights licence and no use restriction is stated anywhere, so the repository's BSD-3-Clause covers them (the same reading as U²-Net). Each file is pinned by SHA-256 in `apps/worker/src/etb_worker/gpu/pins.json` and checked when Modal builds the image. No face-restoration model (GFPGAN) is used |
| Demucs (htdemucs) | stem separation (A09) | MIT | 🔍 unclear | 🔍 checked 2026-10-02, **not used**: the code is MIT ([LICENSE](https://github.com/facebookresearch/demucs/blob/main/LICENSE), Meta; archived 2025-01-01, maintained fork adefossez/demucs), but the weights live outside the repository (dl.fbaipublicfiles.com), neither README nor LICENSE states their licence, and htdemucs was trained on MUSDB18-HQ (research use) plus 800 in-house songs. A09 stays `soon`; parked for Astro in `STATUS.md` |
| Whisper / faster-whisper | transcription (A12), auto subtitles (V17), on our GPU servers only | MIT | MIT | ✅ checked 2026-10-02: the [README](https://github.com/openai/whisper/blob/main/README.md) says "Whisper's code and model weights are released under the MIT License" ([LICENSE](https://github.com/openai/whisper/blob/main/LICENSE), Copyright (c) 2022 OpenAI). We run OpenAI's own `openai-whisper` 20250625 with `large-v3`, downloaded from OpenAI's URL whose path is the file's SHA-256 (the package pins it; so does `pins.json`). faster-whisper (code MIT, SYSTRAN) and its CTranslate2 conversions (model cards say MIT) are not used: huggingface.co can't be reached from the build environment to pin them |
| DeepFilterNet | noise reduction | MIT / Apache-2.0 | same | 🔍 |
| LaMa | object eraser (inpainting) | Apache-2.0 | 🔍 check weights | 🔍 |
| YuNet (OpenCV zoo) | face detection for face blur | 🔍 | 🔍 | 🔍 |
| Face-restoration models (CodeFormer, GFPGAN-class) | "face-friendly" upscale | 🔍 | 🔍 — CodeFormer's licence is understood to be non-commercial; don't add any face model without a verified commercial licence | 🔍 |
| RobustVideoMatting | video background removal | GPL-3.0 | 🔍 | ⚠️ server only, if weights allow commercial use |

## Server tools

| Package | Use | License | Status |
|---|---|---|---|
| ffmpeg / ffprobe | server media processing | LGPL/GPL (Debian's package in the worker image: a GPL build, no nonfree) | ⚠️ server only, checked 2026-09-30 |
| Noto fonts (fonts-noto-core) | the fonts Burn Subtitles draws text with: Noto Sans, Serif and Sans Mono (Latin, Cyrillic, Greek); Debian's package in the worker image | OFL-1.1 | ✅ checked 2026-10-01 |
| librosa | analysis helpers | ISC | 🔍 |
| pyloudnorm | loudness (reference/tests) | MIT | 🔍 |
| potrace | vectorise (Wave 3) | GPL-2.0 | ⚠️ server only |
| vtracer | vectorise alternative | MIT | 🔍 |
| Pydantic, pydantic-settings | worker env and job payload validation (the Python side of the Zod rule) | MIT | ✅ 2.13.5 / 2.15.0, checked 2026-09-29 |
| psycopg 3 (`psycopg[binary]`) | Postgres driver for the worker | LGPL-3.0-only | ⚠️ server only (not distributed), used unmodified; 3.3.6 checked 2026-09-29 |
| boto3 | S3/R2 client for the worker | Apache-2.0 | ✅ 1.43.103, checked 2026-09-29 |

## GPU images (Modal, server only)

Installed only inside the images Modal builds for our GPU functions (`apps/worker/src/etb_worker/gpu/modal_app.py`), at the pinned versions below; never in the worker's own environment or the browser. Their own dependencies are permissive unless listed here.

| Package | Use | License | Status |
|---|---|---|---|
| PyTorch (`torch`, `torchvision`) | runs the models on the GPU (the last release whose PyPI wheels use CUDA 12.8) | BSD-3-Clause | ✅ 2.10.0 / 0.25.0, checked 2026-10-02 |
| NVIDIA CUDA runtime wheels (`nvidia-*-cu12`, `cuda-bindings`) | CUDA, cuDNN and cuBLAS libraries that PyTorch's wheels pull in | NVIDIA proprietary (CUDA EULA: the runtime libraries may be used and redistributed with an application) | ⚠️ server only, inside the Modal images, never distributed; checked 2026-10-02 |
| openai-whisper | Whisper's reference implementation (A12, V17) | MIT | ✅ 20250625, checked 2026-10-02 |
| numba | Whisper's word timing (dynamic time warping) | BSD-2-Clause | ✅ 0.68.0, checked 2026-10-02 |
| spandrel | loads the Real-ESRGAN networks (RRDBNet, SRVGGNetCompact) from their weights, without basicsr | MIT | ✅ 0.4.2, checked 2026-10-02 |
| NumPy | arrays | BSD-3-Clause | ✅ 2.3.5, checked 2026-10-02 |
| ffmpeg (Debian's package, in the Whisper image) | Whisper decodes audio with it | LGPL/GPL (no nonfree) | ⚠️ server only, checked 2026-10-02 |

## Development, build and CI (never shipped)

Build, lint, test and deploy tooling. Not distributed, but the rules still apply (no AGPL, no unclear licences). Versions are what was reviewed; the CI check re-reads each installed package's licence on every run.

| Package | Use | License | Status |
|---|---|---|---|
| Turborepo (`turbo`) | monorepo task runner | MIT | ✅ 2.11.4, checked 2026-09-29 |
| TypeScript | type checking | Apache-2.0 | ✅ 6.0.3 (7.x waits for typescript-eslint support), checked 2026-09-29 |
| ESLint (`eslint`, `@eslint/js`) | linting | MIT | ✅ 10.11.0, checked 2026-09-29 |
| typescript-eslint | TypeScript lint rules | MIT | ✅ 8.70.1, checked 2026-09-29 |
| ESLint plugins: Next.js, React Hooks, Prettier config (`@next/eslint-plugin-next`, `eslint-plugin-react-hooks`, `eslint-config-prettier`) | lint rules | MIT | ✅ checked 2026-09-29. `eslint-config-next` is **not** used: its react/import/jsx-a11y plugins don't support ESLint 10 yet |
| Prettier | formatting | MIT | ✅ 3.9.9, checked 2026-09-29 |
| Vitest | unit tests | MIT | ✅ 5.0.2, checked 2026-09-29 |
| drizzle-kit | generates SQL migrations from the Drizzle schema | MIT | ✅ 0.31.11, checked 2026-09-30 |
| Railway SDK (`railway`) | describes the production project; Railway's CLI plans and applies it from CI (`.railway/railway.ts`) | MIT | ✅ 3.12.0, checked 2026-10-01 |
| Railway CLI (`@railway/cli`) | plans and applies `.railway/railway.ts`, deploy logs, one-off commands; installed in CI at a pinned version | ISC | ✅ 5.63.1, checked 2026-10-01 |
| DefinitelyTyped types (`@types/node`, `@types/react`, `@types/react-dom`, `@types/qrcode`, `@types/pg`, `@types/nodemailer`) | type definitions | MIT | ✅ checked 2026-09-29 |
| Ruff | Python lint and format | MIT | ✅ 0.16.9, checked 2026-09-29 |
| mypy | Python type checking | MIT | ✅ 2.3.1, checked 2026-09-29 |
| pytest | Python tests | MIT | ✅ 9.1.1, checked 2026-09-29 |
| uv / uv_build | Python package manager, build backend | MIT OR Apache-2.0 | ✅ 0.12.20, checked 2026-09-29 |
| pip-audit | Python vulnerability audit in CI | Apache-2.0 | ✅ 2.10.1, checked 2026-09-29 |
| Playwright (`@playwright/test`) | end-to-end tests, screenshots, design comparison | Apache-2.0 | ✅ 1.63.0, checked 2026-09-30 |
| axe-core for Playwright (`@axe-core/playwright`) | accessibility checks in e2e tests | MPL-2.0 | ✅ 4.13.0, checked 2026-09-30 (never shipped) |
| Lighthouse (`lighthouse`) | Lighthouse budgets against the local production build (`scripts/lighthouse.ts`; replaced `@lhci/cli`, whose Lighthouse 12 pulled audited-vulnerable `extract-zip` and `tmp`) | Apache-2.0 | ✅ 13.5.0, checked 2026-09-30 (never shipped) |
| Wrangler | Cloudflare Pages deploy from CI after Go public (run with npx, pinned version) | MIT OR Apache-2.0 | ✅ 4.143.0, checked 2026-09-29 |
| mkcert | local HTTPS certificates for testing on phones (installed on the dev machine, see README) | BSD-3-Clause | ✅ v1.4.4, checked 2026-09-29 |
| GitHub Actions: checkout, setup-node, upload/download-artifact | CI | MIT | ✅ pinned by commit, checked 2026-09-29 |
| pnpm/action-setup | CI: install pnpm | MIT | ✅ pinned by commit, checked 2026-09-29 |
| astral-sh/setup-uv | CI: install uv | MIT | ✅ pinned by commit, checked 2026-09-29 |

## Container images

Pinned by digest (`11-security.md`). Base images also contain Debian/Alpine packages under their own (mostly GPL/LGPL) licences; that's fine for server and local containers, which we don't distribute.

| Image | Use | License | Status |
|---|---|---|---|
| PostgreSQL (`postgres` image) | database, local stack | PostgreSQL | ✅ 18-alpine, checked 2026-09-29 |
| Versity S3 Gateway (`versity/versitygw` image) | S3-compatible storage standing in for R2 locally (replaces MinIO, see Banned) | Apache-2.0 | ✅ v1.8.0, checked 2026-09-29 |
| Mailpit (`axllent/mailpit` image) | catches the local stack's sign-in emails in a web inbox (local only) | MIT | ✅ v1.31.3, checked 2026-09-30 |
| Node.js (`node` image) | base of the web dev container | MIT | ✅ 24-bookworm-slim, checked 2026-09-29 |
| Python (`python` image) | base of the worker image | PSF-2.0 | ✅ 3.12-slim-trixie, checked 2026-09-29 |

## Banned (don't use, with reason)

| Package / model | Reason |
|---|---|
| BRIA RMBG-1.4, RMBG-2.0 weights | Non-commercial license; commercial use needs a paid agreement with BRIA |
| @imgly/background-removal (browser package) | AGPL-3.0 🔍 confirm — treat as banned unless its license is verified otherwise |
| essentia.js / Essentia | AGPL-3.0 |
| Rubber Band library | GPL (commercial license separate) — banned in browser; server only if ever needed |
| Any ffmpeg build with `--enable-nonfree` (e.g. libfdk_aac) | Not redistributable |
| Plausible CE (self-hosted) | AGPL — use Umami instead to keep the "no AGPL" rule simple |
| MinIO (`minio/minio` image) | AGPL-3.0, same reasoning as Plausible CE; upstream also stopped publishing the image (`minio/minio` no longer resolves on Docker Hub, checked 2026-09-29). Local S3 storage uses Versity S3 Gateway |
| TT Hoves | Commercial TypeType font licensed to Uzcosmos for Uzcosmos work only. Embedding it in a website distributes it. Never use it in EditToolbelt |

## Pending review

(Empty. Add rows here instead of installing when unsure.)
