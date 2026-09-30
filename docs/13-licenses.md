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
| Drizzle ORM | DB | Apache-2.0 | ✅ |
| Better Auth | auth | MIT | 🔍 |
| pino | logging | MIT | ✅ |
| structlog | Python logging | MIT / Apache-2.0 | ✅ |
| next-intl | i18n | MIT | 🔍 |
| Lucide | icons | ISC | ✅ lucide-react 1.49.0, checked 2026-09-30 |
| Onest (variable) + IBM Plex Mono | UI and numeric fonts, self-hosted | OFL-1.1 | ✅ |
| Fontsource packages for Onest and IBM Plex Mono (`@fontsource-variable/onest`, `@fontsource/onest`, `@fontsource/ibm-plex-mono`) | where the self-hosted font files come from (copied into the build, subset by `unicode-range`); static Onest weights for the build-time OG images | OFL-1.1 | ✅ 5.3.1 / 5.3.1 / 5.3.0, checked 2026-09-29 |
| PostCSS | CSS build pipeline for Tailwind (build time only) | MIT | ✅ checked 2026-09-30 |
| Umami (self-hosted) | cookieless analytics | MIT | 🔍 |
| Sentry SDKs / GlitchTip | error tracking | MIT / MIT | 🔍 |
| Paddle.js | checkout | vendor terms | ⚠️ checkout route only |
| Pillow | server image probe/ops | HPND (MIT-style) | ✅ |

## Browser processing

| Package | Use | License | Status |
|---|---|---|---|
| Mediabunny | WebCodecs mux/demux, fast video ops | MPL-2.0 | 🔍 |
| @ffmpeg/ffmpeg + our own core build | wasm fallback | wrapper MIT; core LGPL when built with `--disable-gpl` | ⚠️ LGPL build only, separate file, source offer |
| jSquash (avif, webp, jpeg, png, oxipng, resize) | image codecs | Apache-2.0 (underlying codecs BSD/IJG/MIT) | 🔍 |
| libheif-js (+ libde265) | HEIC decode | LGPL-3.0 | ⚠️ separate lazy-loaded file, source offer; HEVC patent question → open questions |
| onnxruntime-web | browser ML | MIT | ✅ |
| mediainfo.js | media info / VFR check | BSD-2-Clause | 🔍 |
| web-audio-beat-detector (or in-house) | BPM | MIT | 🔍 (in-house preferred) |
| Signalsmith Stretch (`signalsmith-stretch`, WASM/AudioWorklet) | tempo/pitch (A08, V13) | MIT | 🔍 — preferred over SoundTouch: permissive licence, no source-offer duty |
| SoundTouch (JS/WASM port) | tempo/pitch fallback | LGPL-2.1 | ⚠️ only if Signalsmith falls short; separate file, source offer |
| qrcode (npm) | QR generation (U01): browser entry only, it builds the matrix and we render SVG/PNG | MIT | ✅ checked 2026-09-30 (1.5.4) |
| fflate | ZIP of batch outputs, loaded only for "Download all" | MIT | ✅ checked 2026-09-30 (0.8.3) |
| `@mediabunny/mp3-encoder` (preferred) or lamejs | MP3 encoding — WebCodecs has no MP3 encoder | package MPL-2.0; LAME inside is LGPL | ⚠️ separate lazy-loaded file, source offer; 🔍 confirm the bundled encoder's licence |
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
| U²-Net / u2netp | background removal (tiny fallback) | Apache-2.0 | Apache-2.0 | 🔍 |
| Real-ESRGAN | image/video upscale | BSD-3-Clause | BSD-3-Clause | 🔍 |
| Demucs (htdemucs) | stem separation | MIT | MIT | 🔍 |
| Whisper / faster-whisper | transcription, auto subtitles | MIT | MIT | 🔍 |
| DeepFilterNet | noise reduction | MIT / Apache-2.0 | same | 🔍 |
| LaMa | object eraser (inpainting) | Apache-2.0 | 🔍 check weights | 🔍 |
| YuNet (OpenCV zoo) | face detection for face blur | 🔍 | 🔍 | 🔍 |
| Face-restoration models (CodeFormer, GFPGAN-class) | "face-friendly" upscale | 🔍 | 🔍 — CodeFormer's licence is understood to be non-commercial; don't add any face model without a verified commercial licence | 🔍 |
| RobustVideoMatting | video background removal | GPL-3.0 | 🔍 | ⚠️ server only, if weights allow commercial use |

## Server tools

| Package | Use | License | Status |
|---|---|---|---|
| ffmpeg / ffprobe | server media processing | LGPL/GPL (our build, no nonfree) | ⚠️ server only |
| librosa | analysis helpers | ISC | 🔍 |
| pyloudnorm | loudness (reference/tests) | MIT | 🔍 |
| potrace | vectorise (Wave 3) | GPL-2.0 | ⚠️ server only |
| vtracer | vectorise alternative | MIT | 🔍 |
| Pydantic, pydantic-settings | worker env and job payload validation (the Python side of the Zod rule) | MIT | ✅ 2.13.5 / 2.15.0, checked 2026-09-29 |
| psycopg 3 (`psycopg[binary]`) | Postgres driver for the worker | LGPL-3.0-only | ⚠️ server only (not distributed), used unmodified; 3.3.6 checked 2026-09-29 |
| boto3 | S3/R2 client for the worker | Apache-2.0 | ✅ 1.43.103, checked 2026-09-29 |

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
| DefinitelyTyped types (`@types/node`, `@types/react`, `@types/react-dom`, `@types/qrcode`) | type definitions | MIT | ✅ checked 2026-09-29 |
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
