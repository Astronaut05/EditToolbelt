# 13 — License register

Every third-party library, model, font and icon set goes here **before** it's installed. CI reads the machine-readable copy (`licenses.json`, created in M0) and fails if a dependency isn't listed. `/licenses` on the site is generated from it.

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
| Tailwind CSS | styling | MIT | ✅ |
| Zod | validation | MIT | ✅ |
| Drizzle ORM | DB | Apache-2.0 | ✅ |
| Better Auth | auth | MIT | 🔍 |
| pino | logging | MIT | ✅ |
| structlog | Python logging | MIT / Apache-2.0 | ✅ |
| next-intl | i18n | MIT | 🔍 |
| Lucide | icons | ISC | ✅ |
| Onest (variable) + IBM Plex Mono | UI and numeric fonts, self-hosted | OFL-1.1 | ✅ |
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
| qrcode (npm) | QR generation | MIT | 🔍 |
| fflate | ZIP of batch outputs | MIT | 🔍 |
| `@mediabunny/mp3-encoder` (preferred) or lamejs | MP3 encoding — WebCodecs has no MP3 encoder | package MPL-2.0; LAME inside is LGPL | ⚠️ separate lazy-loaded file, source offer; 🔍 confirm the bundled encoder's licence |
| `@mediabunny/aac-encoder` | AAC-LC encoding where the browser's WebCodecs can't (feature-detect first) | package MPL-2.0; WASM build of FFmpeg's AAC encoder (LGPL) | ⚠️ separate lazy-loaded file, source offer; AAC patent question → open question 10 |
| pdf-lib | images to PDF (Wave 3) | MIT | 🔍 |
| vtracer (WASM) | image to SVG (Wave 3) | MIT | 🔍 |
| jsQR / ZXing | QR decode — **tests only**, not shipped | Apache-2.0 | 🔍 |

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

## Banned (don't use, with reason)

| Package / model | Reason |
|---|---|
| BRIA RMBG-1.4, RMBG-2.0 weights | Non-commercial license; commercial use needs a paid agreement with BRIA |
| @imgly/background-removal (browser package) | AGPL-3.0 🔍 confirm — treat as banned unless its license is verified otherwise |
| essentia.js / Essentia | AGPL-3.0 |
| Rubber Band library | GPL (commercial license separate) — banned in browser; server only if ever needed |
| Any ffmpeg build with `--enable-nonfree` (e.g. libfdk_aac) | Not redistributable |
| Plausible CE (self-hosted) | AGPL — use Umami instead to keep the "no AGPL" rule simple |
| TT Hoves | Commercial TypeType font licensed to Uzcosmos for Uzcosmos work only. Embedding it in a website distributes it. Never use it in EditToolbelt |

## Pending review

(Empty. Add rows here instead of installing when unsure.)
