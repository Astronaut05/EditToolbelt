# Status

**Milestone:** M2, the launch set · **M1 done, M2 about 98 % done** (15 of 15 launch tools and all 11 M2b tools live; 25 pair pages, 5 held: HEIC ×2 for open question 10, AVI for the server path, PNG → ICO for Wave 3, GIF → MP4 as the tool page is that pair; left: the local-launch checks) · autonomous mode until the M2 local launch (`CLAUDE.md` rule 10)

## Done

- M0 foundations (#4), design handover "Signal" (#5), open question 19 (#6).
- Autonomous-mode rules, `docs/DECISIONS.md`, this file (#7).
- Tool registry: all 75 tools with search, conversion pairs and the COOP/COEP route list (#8).
- Design system: Signal tokens mirrored in Tailwind, every shared component, ToolShell for all six `ui` types against a dummy engine (#9).
- Clickable skeleton: home with instant search, 6 hubs, 75 `soon` pages, header, footer, search overlay, legal stubs, `/licenses`, 404. The design screens are rebuilt in the workshop and match the PNGs at 1440 and 390 px, light and dark (#10, #11).
- Security headers (`_headers`, applied by `pnpm preview`), a hash-based CSP on every page with zero violations, COOP/COEP on `/video-converter` (#12).
- SEO scaffolding: metadata and JSON-LD from the registry, sitemap (working pages only), robots.txt, Open Graph images for home, hubs and every tool (#13).
- PWA: manifest, icons, a service worker that precaches the app shell and works offline (#14).
- Cookieless analytics: page views, the `09` events and Web Vitals to a self-hosted collector, off unless `ANALYTICS_URL` and `ANALYTICS_WEBSITE_ID` are set (#15).
- Component gallery in the workshop (every `packages/ui` component, light and dark) and a working ToolShell demo for each `ui` type against the dummy engine (#16).
- Tests and budgets in CI: Playwright on Chromium, Firefox, WebKit and a phone (CSP, isolation, axe on every page type, keyboard, links), Lighthouse on 5 pages, initial JS ≤ 150 KB (see `docs/DECISIONS.md`) (#17).
- CodeQL findings in the build scripts fixed (#18). **M1 done.**
- M2: the live tool page (the tool, then how-to, why, FAQ and related tools, with FAQ JSON-LD), and the first three launch tools: Timecode, Aspect Ratio and Bitrate calculators, with inputs in the URL and copy buttons (#20).
- M2: Color Converter (every notation, nearest CSS name, tints and shades) and QR Code Generator (7 content types, logo, PNG up to 4096 px and a clean SVG, codes checked by decoding them) (#21).
- M2: Subtitle Converter (SRT, VTT, ASS/SSA, SBV in; SRT, VTT, ASS, SBV, TXT out; encodings detected; a report of what each format drops; batches as a ZIP) and the first pair pages: `/convert/srt-to-vtt`, `/convert/vtt-to-srt`, `/convert/ass-to-srt` (#22).
- M2: Image Converter and Compress Image on the image engine (WASM codecs in a worker, EXIF kept without GPS, target size, batches of 50), with 8 image pair pages such as `/convert/png-to-jpg` (#23).
- M2: Crop Image (a real crop box: ratios, exact px, drag or type, Rotate 90°, undo; batches crop to a ratio, centered) and Resize Image (exact W × H with keep ratio, pad, fill or stretch; width, height, %, longest side, presets; Lanczos), on the new `image-geometry` engine (#24).
- M2: the video tools on WebCodecs through Mediabunny (#26):
  - Trim Video: Fast copies from the keyframe before In; Precise re-encodes, frame-exact; a real timeline with frames, a preview and typed times.
  - Compress Video: 8-100 MB targets for Discord, WhatsApp and email, auto resolution, H.264/H.265/AV1/VP9.
  - Video to GIF: our own two-pass quantiser, frame differencing, GIF or animated WebP, size estimate.
  - Extract Audio: MP3, WAV, M4A, AAC, FLAC, OGG; AAC and Opus copied without re-encoding.
  - Pair pages: `mp4-to-gif`, `mov-to-gif`, `mp4-to-mp3`, `mov-to-mp3`.
- M2: Remove Background, the last launch tool (#27):
  - Light mode (u2netp, 4.6 MB, WASM) everywhere; Quality mode (BiRefNet_lite fp16, 115 MB) where WebGPU has 16-bit floats, falling back to Light with a note.
  - Transparent, color, blur or another image behind; soft or hard edges; PNG or WebP at full size (up to 24 MP); edges fitted with a guided filter.
  - Refine by hand: a keep/erase brush on the result. Changing a setting reuses the cut-out (under a second).
  - Models and ONNX Runtime come from `MODELS_BASE_URL`, fetched and checksum-checked by `pnpm models` (run by `build` and `dev`), downloaded once in the browser with progress and cached.
- M2: "Use in another tool": the Next links under a result carry the file to the next tool in memory, with no re-upload (#28).
- M2b: Subtitle Sync (shift by ms, from a cue on; frame rate 23.976 ↔ 25 and more; two-point sync that fixes offset and drift). Only the times are rewritten, so styles, positions and comments stay as they were (#29).
- M2b: Rotate & Flip Image (straighten by 0.1° with auto-crop or an expanded canvas, 90° turns and flips without resampling, batches of 50). Also fixes a half turn in Crop Image that returned the original pixels (#30).
- CI: Lighthouse's LCP gate now reads runs with applied throttling (stable 1.6-1.8 s) instead of simulated ones (1.9-2.7 s on one build); the limit is unchanged (#30).
- M2b: the video tools (#31):
  - Video Converter: MP4, MOV, WebM, MKV; remuxes when the tracks fit the target (instant, frames untouched), re-encodes only what doesn't. AVI and ProRes wait for the server path (M3). The route is no longer cross-origin isolated, since WebCodecs doesn't need it. Pair pages `mov-to-mp4`, `mkv-to-mp4`, `webm-to-mp4`, `mp4-to-webm`.
  - GIF to MP4: our own GIF reader, every frame keeps its own delay, transparency filled, 1 to 10 plays.
  - Mute Video: all the audio (video packets byte-identical) or only a range, with 10 ms fades.
  - Video Info: codec, profile, bit depth, color, HDR, rotation, and a measured VFR check, with what to do about each, as text or JSON.
- M2b: the audio tools (#32):
  - Audio Converter: MP3 (LAME, 128-320 kbps), WAV 16/24-bit, M4A/AAC, FLAC, OGG/Opus; sample rate and channels; tags kept. Six pair pages such as `wav-to-mp3`.
  - Trim Audio: keep or remove one range on the real waveform, to the millisecond; fades in and out; WAV and FLAC cut to the sample.
  - BPM & Key Finder: tempo with half/double alternatives, beat markers as CSV or text, key with its Camelot code, plus tap tempo and a metronome. Tested on a generated set (30 loops, 30 progressions); real songs are for the stress test.
  - MP3 and FLAC always use our own encoders, and every audio re-encode goes through one gapless pipeline (WebKit's MP3 encoder dropped the last frames).
- M2b: Color Palette from Image (k-means in Oklab, deterministic; CSS, JSON, ASE or a PNG card) and Color Picker from Image (a loupe, 1 px exact or 3 × 3 and 5 × 5 averages, keyboard picking, up to 24 picks). All 11 M2b tools are live (#33).

## Next

1. Checkpoint 2 (M1 done): sent.
2. M2 local-launch checks: Playwright on Chromium, Firefox, WebKit and phone, and the Lighthouse budgets, on the production build.
3. Checkpoint 3 (M2 local launch ready to stress-test).

## Blocked

- HEIC opens only in Safari until open question 10 (HEVC patents) is answered; `/convert/heic-to-jpg` and `/convert/heic-to-png` wait for it. Everything else continues.
- Remove Background, Quality mode and the model benchmark: huggingface.co is blocked from this build environment, so BiRefNet_lite has not been run here. CI downloads it and prints its SHA-256 to pin. The benchmark (IoU on 5 photos with reference masks, desktop and 2 phones) needs license-free photos with masks and a WebGPU device, so it's for the stress test. Light mode is tested end to end.
- Housekeeping only: `docs/design-handover` can't be deleted from this session (HTTP 403); see `docs/DECISIONS.md`.

## Run it

```sh
git pull && pnpm install
pnpm preview                   # production build: http://localhost:4173 (try /remove-background, /trim-video, /video-to-gif)
pnpm models                    # AI models for Remove Background into apps/web/public/models (build runs it too)
pnpm workshop                  # design screens, components, ToolShell demos: http://localhost:4173/workshop
pnpm e2e                       # Playwright (pnpm exec playwright install once)
pnpm lighthouse                # after pnpm build
docker compose up --watch      # dev stack: http://localhost:3000
```
