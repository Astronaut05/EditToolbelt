# Status

**Milestone:** M2, the launch set · **M1 done, M2 about 60 % done** (10 of 15 launch tools live, 11 of 17 pair pages) · autonomous mode until the M2 local launch (`CLAUDE.md` rule 10)

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

## Next

1. Checkpoint 2 (M1 done): sent.
2. M2 launch set, in this order: the video tools (V01 Trim and V06 Extract Audio, then V02 Compress and V04 Video to GIF), then Remove Background (P07).
3. M2b (11 tools), then checkpoint 3.

## Blocked

- HEIC opens only in Safari until open question 10 (HEVC patents) is answered; `/convert/heic-to-jpg` and `/convert/heic-to-png` wait for it. Everything else continues.
- Housekeeping only: `docs/design-handover` can't be deleted from this session (HTTP 403); see `docs/DECISIONS.md`.

## Run it

```sh
git pull && pnpm install
pnpm preview                   # production build: http://localhost:4173 (try /crop-image, /resize-image, /image-converter)
pnpm workshop                  # design screens, components, ToolShell demos: http://localhost:4173/workshop
pnpm e2e                       # Playwright (pnpm exec playwright install once)
pnpm lighthouse                # after pnpm build
docker compose up --watch      # dev stack: http://localhost:3000
```
