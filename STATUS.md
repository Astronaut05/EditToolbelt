# Status

**Now:** the private live site at the real domain (Phase 1 with Astro: Cloudflare R2, Railway, Modal, email, Google, Access, Paddle sandbox, first deploy). **Milestone:** M8, the rest of Wave 2 · **started: Contrast Checker, Print Size & DPI Calculator, Split Image into Grid, Photo Metadata Viewer & Remover, Social Media Image Resizer, Loudness Meter, Normalize Loudness, Fade In / Fade Out, Audio Channel Tools, Rotate & Flip Video, Resize Video for Social, Extract Frames, Remove Silence, Add or Replace Audio in Video, Merge Audio and LUT Preview (beta)**. M6, the public API, is in review: API keys, the panel's connect flow, the OpenAPI document and `/developers`, the typed client and a script that needs only a key. M5 part 1 is in review: payments built complete and switched off (Paddle, Click and Payme behind one interface, the purchase store, the switches, `/credits/buy`, Admin → Payments, the welcome grant); turning them on is `docs/runbooks/turn-on-payments.md`, after Astro's contracts. M5's GPU tools are in review too. M4 is done: uploads straight to storage, the job queue, the jobs API, and Compress Video, VFR to CFR and Burn Subtitles on our servers. M3 is done: accounts, the admin, tool status from the database, alerts and the digest. M1, M2 and M2b are done: all 26 Wave 1 tools live, 25 pair pages (5 held: HEIC ×2 for open question 10, AVI for the server path, PNG → ICO for Wave 3, GIF → MP4 as the tool page is that pair)

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
- Every video and audio tool loads its engine (and Mediabunny) on first use, not with the page: 167-172 KB of script instead of 325-335 KB (#34).
- M2b remainder, part 1: the timeline holds several ranges (add, select, remove; they never overlap), and Trim Audio keeps or removes any number of them. Parts join with a 10 ms crossfade, exactly as long as the kept parts, to the sample (#35).
- M2b remainder, part 2: Trim Video keeps or removes several ranges and joins them. Fast copies each part from its keyframe; Precise smart-cuts VP8 and VP9 (only the frames from each cut to the next keyframe are re-encoded, the rest copied byte for byte) and re-encodes anything else. The audio crossfades 10 ms at each join (#36).
- M3, part 1: the database. Every table in `docs/04` in `packages/db` (Drizzle, Postgres 18, UUIDv7 ids), SQL migrations (`pnpm db:migrate`, run by the stack's `migrate` service), the append-only ledger (trigger, sign checks, `applyCredit` with row locks) and an append-only audit log. Integration tests run on a real Postgres in CI (#37).
- M3, part 2: the server build (`ETB_TARGET=server`, what the local stack runs) with accounts. Sign in with an email link (Mailpit catches it on the stack at localhost:8025) or Google, `/account` with profile, "Download my data" and delete (30-day restore), nonce CSP on signed-in pages, `/healthz` and `/readyz` (#38).
- M3, part 3: tool status from the database (admin changes show within 30 s) and the admin: dashboard, tools, users (credits, disable, revoke keys, export, delete), audit log and system, behind TOTP; `pnpm admin:promote` makes the first admin; `GET /api/v1/tools` (#39).
- M3, part 4: the worker's scheduler. Heartbeats; alerts to Telegram, email as backup, with a 30-minute cool-down (missing heartbeat, database connections, disk, tool failure rate, queue wait, ledger mismatch); every night at 03:00 Tashkent the ledger check, the 30-day account scrub and the retention purges; the daily digest at 09:00 Tashkent. Admin → System lists recent alerts (#40).
- Dependabot's one alert (esbuild under drizzle-kit, dev only) cleared with a pnpm override (#41).
- M4, part 1: uploads straight to storage. `POST /api/v1/uploads` checks the tool, limits and type, and hands out presigned part URLs that each accept only their exact size; the browser PUTs the parts to storage itself; `complete` joins them and checks the size. `/readyz` checks storage (#42).
- M4, part 2: the worker's job queue. Job slots claim jobs (`SKIP LOCKED`, per-tool caps), heartbeat every 5 s, and the reaper requeues a job whose worker died (twice, then it fails and refunds). Every upload is probed with ffprobe before use. ffmpeg runs sandboxed (clean env, `prlimit`, process group, timeout, no protocols but files). A job's input is deleted the moment it ends; the sweeper deletes outputs after 60 min and aborts abandoned uploads (#43).
- M4, part 3: the jobs API. `POST /api/v1/jobs/quote` prices a job from the probe and says what pays: one of 3 free jobs a day, or credits. `POST /api/v1/jobs` starts it at that price (Idempotency-Key, credits reserved), at most 2 at once per account (4 once paid). `GET /api/v1/jobs/:id/events` streams progress, `GET /api/v1/jobs/:id` gives a 10-minute download link, and cancel gives credits back (#44).
- M4, part 4: Compress Video on our servers. Two-pass ffmpeg with the browser tool's plan (H.264, H.265, AV1, VP9). The tool page offers the server for files over the browser's limit, files the browser can't read, or on request: it says why and what it costs (a free daily job or credits), asks again if the server's price differs, uploads in parallel parts, shows live progress and names the result on the page. A 1.06 GB video came back at 24.4 MB for a 25 MB target in 80 s on the local stack; killing the worker mid-job requeued it and it still finished (#45).
- M4, part 5: VFR to CFR, the first server-only tool (an admin switches it on): frames put on a steady clock with the sound re-timed to match, visually lossless, 10-bit kept; a file that is already constant is refused before anything is charged. Variable frame rate is now read from the frames' own clock. Admin → Jobs (filters, detail, cancel with refund, retry), job stats by day on the dashboard, and `docs/runbooks/` (#46).
- M4, part 6: Burn Subtitles (an admin switches it on). SRT, VTT or ASS burned in with libass: Noto fonts (Latin, Cyrillic, Greek), size, color, outline or a background box, top or bottom; ASS keeps its own styles; Windows-1251 and -1252 files read correctly. The subtitle file goes up as its own upload beside the video, and goes with the job (#47).
- M6, part 1: API keys. Make one in `/account` → API keys (shown once, with a copy button; up to 10), choose what it can do (`jobs:read`, `jobs:write`, `account:read`), revoke it there. Send it as `Authorization: Bearer etb_live_…` from a script or any site: every `/api/v1` answer allows any origin without credentials, and rate limits count per key (#48).
- M6, part 2: the panel's connect flow. The panel asks `POST /api/v1/auth/device` for a code, shows `BCDF-GHJK` and opens `/connect`; the person signs in, sees what it asks for and approves; the panel's poll of `POST /api/v1/auth/device/token` then answers its API key, once (#49).
- M6, part 3: the API described once. Zod schemas for every body in `@etb/core/api`; the routes read requests with them; `GET /api/v1/openapi.json` (OpenAPI 3.1) and `/developers` (keys, a curl walkthrough of a whole job, every endpoint) are generated from them. New: `GET /api/v1/tools/:id` with the options' JSON Schema, `GET /api/v1/me/credits` (#50).
- M6, part 4: `@etb/api-client`, the typed client, now behind the website's server path; `/examples/run-tool.mjs` (Node 20, no packages) runs any server tool with only an API key: parts in parallel, the price, progress, the download (#51).
- Fix: an upload whose file is gone (cancelled or swept) no longer stalls the worker's probe. It used to be retried at once, forever, holding up every upload behind it; now it's refused once, and the API asks for the file again. A storage outage waits 5 s between tries (#52).
- M8, the rest of Wave 2, starts (beta): Contrast Checker (the WCAG 2.2 ratio, AA and AAA for normal and large text and UI, and the nearest passing text or background color with the same hue) and Print Size & DPI Calculator (pixels to cm, mm or inches; pixels a paper size needs; the DPI of a print; the largest paper an image fills; an image's size read in the browser) (#53).
- M8: Split Image into Grid (beta). 3 × 3 profile grids, carousels and panoramas, or any grid up to 10 × 10; tiles cut pixel for pixel in the browser and downloaded as one ZIP, numbered row by row or in posting order, with optional feed gaps so the picture lines up across a profile grid (#54).
- M8: Photo Metadata Viewer & Remover (beta). Drop photos to see camera, settings, date, people and GPS at once; remove everything, the location only, or all but the camera and settings. JPG, PNG and WebP keep their pixels byte for byte; the orientation and colour profile always stay (#55).
- M8: Social Media Image Resizer (beta). 14 sizes on Instagram, YouTube, TikTok, X, LinkedIn, Facebook and Pinterest, all from one image in one go. Each crop keeps the focal point you click in frame; or the whole image fits on a blurred copy of itself or a color. YouTube and X upload limits are kept by lowering the quality just enough. Each size is dated and reviewed every quarter (#56).
- M8: Loudness Meter and Normalize Loudness (beta). Integrated, short-term and momentary LUFS, loudness range and 4× oversampled true peak to ITU-R BS.1770-4 and EBU R128. The meter shows a graph and pass or fail for YouTube, Spotify, Apple Music, podcasts, EBU R128 and US TV. The normaliser hits −14, −16, −23, −24 or any target with a −1 dBTP ceiling, adding a true-peak limiter only when the gain needs it, and measures the file it made. Our own implementation, checked against the EBU's test signals and pyloudnorm (#57).
- M8: Fade In / Fade Out and Audio Channel Tools (beta). Fades with linear, exponential, logarithmic or S-curves, exact to their formulas. Channel tools: stereo to mono (mixed or one side), one side on both to fix a lav in one ear, swap, invert, split into two files, mono to stereo. A stereo file is checked on arrival for a silent side, dual-mono or an inverted side, and the fix is picked (#58).
- M8: Rotate & Flip Video and Resize Video for Social (beta). Rotate 90°, 180° or 270° and flip, by turning every frame (plays upright everywhere) or fast by the rotation flag (instant, lossless). Resize to 9:16, 4:5, 1:1, 16:9 or any size: fill and crop with framing sliders, or fit on a blurred copy or a color (#63).
- M8: Extract Frames / Thumbnail (beta). The exact frame at the In point, a frame every few seconds, a number of frames evenly spaced, or a 3 × 3 to 4 × 6 contact sheet with times; PNG, JPG or WebP at a chosen width; several frames as a ZIP named by time (#63).
- M8: Remove Silence (beta). The pauses in a voiceover, podcast or lecture are found as it loads: below a threshold set from the noise floor or in dBFS, for at least a set length. They show as ranges on the timeline to adjust or drop, then are removed (keeping 0.1 s beside the sound) or shortened to a set pause. Download the shorter audio, or the cut list as CSV to make the same cuts to a video (#63).
- M8: Add or Replace Audio in Video (beta). Replace a video's sound with music, or mix the music under it, each at its own level; fade in and out, start the music at any point, loop it or play it once. The picture is copied as it is; the new sound is AAC or Opus at 48 kHz, whatever the music's own rate (#63).
- M8: Merge Audio (beta). Drop 2 to 20 files, put them in order (arrow buttons, keyboard too), and join them back to back, with equal-power crossfades or with gaps, or mix them together, lowered just enough not to clip. Files at different rates meet at 48 kHz; the result can be normalised to −14, −16 or −23 LUFS (#63).
- M8: LUT Preview on Image (beta). Drop a still and a .cube LUT (1D or 3D), set the intensity, and compare before and after; download the graded image. Tetrahedral interpolation, matching the LUT within 1/255; a broken .cube says what's wrong and on which line (#63).
- Fix: a setting changed while a file is being read is no longer overwritten by what the file suggests when the read ends (Audio Channel Tools: Split picked straight after the drop) (#63).
- CI runs the browser tests against the production image too, through a stand-in Cloudflare Access (152 pass on Chromium). The server build's search index is fresh within 30 s, as tool status is (#65).
- Production: after every deploy, the Smoke workflow waits for the new commit on `/healthz` and checks the live site through Access; `docs/runbooks/production.md` names every setting and where it lives (#64).

- M5, part 1 (in review): payments built and switched off, with the M5 review's fixes. **M5 ≈ 50 %** (payments done, off; GPU tools next).
  - Three locks, all off by default: `PAYMENTS_ENABLED`, the admin switch per provider in Admin → Payments (refused, with the reason, while its keys or fiscal codes are missing; audit-logged), and the provider's keys. While off: no "Buy credits" anywhere, and `/credits/buy` and checkout answer 404. A provider's webhooks answer while its keys are set, so refunds, chargebacks and payments already under way still land; only new payments are refused. Webhook errors alert at once.
  - Buying: `/credits/buy` (Click and Payme first in sum for Uzbekistan, Paddle first in dollars elsewhere; never COEP), `POST /api/v1/credits/checkout` (session only), `/credits/return` follows the purchase, `/account` lists purchases. Webhooks at `/api/webhooks/{paddle,click,payme}`.
  - The purchase store: complete and refund move the purchase and its ledger row in one transaction, idempotent; a refund may take a balance below zero (paid jobs then wait for a top-up). Webhook events are processed again after a failure.
  - The welcome grant: 30 credits once per verified inbox at sign-in; throwaway domains refused.
  - A job quoted as a free daily job is never charged credits unasked (`quote_funding`, 409, the site asks again).

## Next

0. Phase 1 (with Astro): the production setup, step by step, each checked from CI (`.github/workflows/ops.yml`). Then Phase 2 runs on its own: M5 (payments built and off), M5's GPU tools on Modal, the rest of M8 and Wave 3, a final pass.

1. Checkpoints 1, 2 and 3, and the M3 and M4 sign-offs: sent.
2. M6 sign-off once parts 1 to 4 merge.
3. M8: the rest of Wave 2, browser tools first, then CPU server tools. M7 (the Premiere panel) follows M5's GPU tools.
4. M5: payments are built and off (part 1, in review). Turning them on follows `docs/runbooks/turn-on-payments.md` once Astro has the Paddle, Click and Payme contracts and the fiscal codes. Then M5's GPU tools.

## Waiting for Astro's approval

Applies of the Railway project (Actions → Railway → "Apply the plan", environment `railway`). Work goes on around them.

- **Railway: create Postgres, web and worker** (plan: 3 to add, 0 to change, 0 to destroy). Approve at Actions → Railway → run 36946470385 → Review deployments. Waiting on it: the custom domains, then the first deploy (Phase 1 steps 2 and 9).

## Blocked

- HEIC opens only in Safari until open question 10 (HEVC patents) is answered; `/convert/heic-to-jpg` and `/convert/heic-to-png` wait for it. Everything else continues.
- Remove Background, Quality mode and the model benchmark: huggingface.co is blocked from this build environment, so BiRefNet_lite has not been run here. CI downloads it and prints its SHA-256 to pin. The benchmark (IoU on 5 photos with reference masks, desktop and 2 phones) needs license-free photos with masks and a WebGPU device, so it's for the stress test. Light mode is tested end to end.
- Housekeeping only: `docs/design-handover` can't be deleted from this session (HTTP 403); see `docs/DECISIONS.md`.
- M4's `LocalGpu` backend (upscale, stems and transcription on the 1080 Ti): this build environment has no GPU and can't download models (huggingface.co is blocked). The queue, the processor interface and `gpu_seconds` are ready for it; the GPU image (pinned Pascal build), the models and the three tools are built where the GPU is: on Astro's PC, during the stress test, or with M5's backend.

## Run it

```sh
git pull && pnpm install
pnpm preview                   # production build: http://localhost:4173 (try /remove-background, /video-converter, /bpm-key-finder)
pnpm models                    # AI models for Remove Background into apps/web/public/models (build runs it too)
pnpm workshop                  # design screens, components, ToolShell demos: http://localhost:4173/workshop
pnpm e2e                       # Playwright (pnpm exec playwright install once)
pnpm lighthouse                # after pnpm build
pnpm db:migrate                # apply migrations to DATABASE_URL (the stack's migrate service does it for you)
docker compose up --watch      # dev stack: http://localhost:3000 (sign in at /sign-in; emails at http://localhost:8025; /admin after pnpm admin:promote)
docker compose exec worker python -m etb_worker --task daily_digest   # send the digest now (lands in Mailpit, or Telegram if set up)
```

Server Compress Video on the stack: in Admin → Tools → Compress Video, tick "Server path on" and save. Within 30 s, /compress-video offers "Use our servers instead" after you add a video. Signed in, you get 3 free server jobs a day. VFR to CFR and Burn Subtitles: in Admin → Tools, set each one's status to beta; its page works within 30 s. Admin → Jobs lists every server job.

Payments on the stack: Admin → Payments shows the three locks per provider and refuses to switch one on without its keys; with none on, `/credits/buy` is a 404 and no page offers credits. Buying needs a provider's sandbox keys in `.env` and `PAYMENTS_ENABLED=true` (`docs/runbooks/turn-on-payments.md`). The server e2e tests run a whole purchase with a stand-in provider: `TEST_DATABASE_URL=… pnpm --filter @etb/web e2e:server`.

API docs on the stack: http://localhost:3000/developers and /api/v1/openapi.json. With a key: `ETB_API=http://localhost:3000/api/v1 ETB_KEY=etb_live_… node apps/web/public/examples/run-tool.mjs compress-video clip.mp4 '{"targetMb":25}'`. API keys: sign in, open /account → API keys, make one, then `curl -H "Authorization: Bearer etb_live_…" http://localhost:3000/api/v1/me`. The panel's connect flow by hand: `curl -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:3000/api/v1/auth/device`, open its `verification_uri_complete`, approve, then post its `device_code` to `/api/v1/auth/device/token`.
