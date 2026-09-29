# 10 — Performance

Speed is the selling point, so it has budgets, and CI fails when they're broken.

## Where speed comes from

- **Page speed** is hosting + delivery: static HTML from the CDN edge, tiny initial JS, fonts self-hosted and preloaded.
- **Processing speed** is architecture: browser tools skip the network entirely (no upload, no queue, no download). Server tools are limited mostly by upload time — so upload directly to storage in parallel parts and don't send what isn't needed (e.g. extract audio in the browser before sending it for transcription).

## Budgets (p75, real users, mid-range phone on 4G unless noted)

| Metric | Budget |
|---|---|
| LCP (tool pages) | ≤ 1.8 s |
| INP | ≤ 150 ms |
| CLS | ≤ 0.05 |
| Initial JS on a tool page (gzip) | ≤ 120 KB before the engine loads |
| HTML + critical CSS | ≤ 50 KB |
| Engine load after first file drop (cached) | ≤ 300 ms |
| Engine load after first file drop (cold, desktop broadband) | ≤ 2 s for non-ML engines |
| Time to result, simple image op (resize/convert, 12 MP) | ≤ 1.5 s desktop, ≤ 4 s phone |
| Time to result, trim 1-min 1080p video (keyframe-accurate mode) | ≤ 3 s desktop |
| Server job queue wait p95 (normal load) | ≤ 10 s CPU tools; ≤ 30 s GPU tools incl. cold start |

Measure: Lighthouse CI on every PR for 5 representative tool pages (budget file in repo); real-user Web Vitals sent as cookieless analytics events; Playwright timing tests for the processing budgets on a fixed CI machine (compare to baseline, fail on >20 % regression).

## Loading strategy

- Tool pages are Server Components; the workspace is a client component that renders instantly with the drop zone. **The engine is not in the initial bundle.**
- On idle (`requestIdleCallback`) after page load, prefetch the tool's engine JS (small). WASM/model files load on first file drop, or on hover/focus of the drop zone on desktop.
- WASM and model files: served from our CDN with immutable cache headers and content-hash filenames; stored in Cache Storage by the service worker; streamed compilation (`WebAssembly.instantiateStreaming`).
- ML model size budget for browser models: **≤ 120 MB** (decided 2026-09-29, to fit BiRefNet_lite fp16 at 115 MB). Show a one-time progress bar: "Downloading the AI model (115 MB), first time only". On metered/slow connections (`navigator.connection.saveData` or effective type 2g/3g) ask before downloading. Models over 25 MiB are served from the R2 `models.` subdomain (`01` → Hosting). Offer server processing if the device can't load it, once the server path exists.
- Fonts: Onest (variable) + IBM Plex Mono, subset to Latin + Cyrillic **plus U+02BB and U+2018** (Uzbek oʻ gʻ live outside the basic Latin subset — without them the ʻ falls back to another font), `font-display: swap`, preload the UI font.
- Images on pages: AVIF/WebP, sized, lazy below the fold.
- No third-party scripts on tool pages except the self-hosted analytics script (tiny, deferred).

## Processing performance rules

- Prefer hardware paths: WebCodecs encode/decode, WebGPU for ML. Fall back to WASM with a note if slow.
- For video: "fast mode" (cut on keyframes, stream-copy, no re-encode) is the default where the user's edit allows; "precise mode" re-encodes. Show which will be used.
- Reuse decoded data across tool handoffs ("Use in another tool") without re-decoding when possible.
- Batch jobs run with concurrency = `min(hardwareConcurrency - 1, 4)` workers.
- Never block the main thread > 50 ms (long-task monitoring in dev).

## Server-side

- Upload: multipart, 4 parallel parts of 8–16 MB, direct to storage.
- Workers run in the same region as the bucket.
- GPU: keep one warm instance during peak hours when queue data shows cold starts hurting (config toggle, cost visible in admin).
- Download: presigned URL straight from storage/CDN, never proxied through the app.
- DB: all queue queries use the partial index; no N+1 in admin lists.
