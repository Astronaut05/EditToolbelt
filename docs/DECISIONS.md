# Decisions

Calls made without Astro while working autonomously (`CLAUDE.md` rule 10), newest last. Each entry: date, decision, why, how to reverse. Earlier decisions (M0 and its sign-off) are in `CHANGES.md`.

## 2026-09-29 · Autonomous mode starts

**Decision:** From now until the M2 local launch, work continues through M1a, M1b, M2 and M2b without waiting for sign-off. Checkpoints: (1) M1a skeleton clickable, (2) M1 done, (3) M2 local launch ready to stress-test. `CLAUDE.md` rules 6 and 10 and the header of `docs/14-open-questions.md` say so.
**Why:** Astro's instruction of 2026-09-29.
**Reverse:** restore rule 10 ("Milestone gates") and the "stop and ask" lines from git history.

## 2026-09-29 · One PR at a time through the session branch

**Decision:** Every topic PR is opened from `claude/youthful-ramanujan-1xzkfr`. After it squash-merges, the branch restarts from the new `main` for the next topic. PRs are therefore sequential, not parallel.
**Why:** this session's git access can push that branch only; pushing or deleting any other branch is refused (HTTP 403, organization policy). One topic per PR still holds.
**Reverse:** allow the session to push other branches; then use one branch per topic (`feat/…`, `docs/…`).

## 2026-09-29 · `docs/design-handover` was already merged

**Decision:** The design handover PR was opened and squash-merged as #5 before autonomous mode began, so there was nothing left to open. The branch itself stays: deleting it is refused (HTTP 403, same policy).
**Why:** the design files are on `main` since c7fdf33.
**Reverse:** nothing to reverse. To clean up, delete `docs/design-handover` in GitHub → Branches, or turn on Settings → General → "Automatically delete head branches".

## 2026-09-29 · Repository name in API calls

**Decision:** GitHub API calls keep using `Astronaut05/EditBench`. GitHub redirects that name to `Astronaut05/EditToolbelt`.
**Why:** this session's GitHub access is scoped to the old name, and calls with the new name are refused.
**Reverse:** re-scope the session to `Astronaut05/EditToolbelt`.

## 2026-09-29 · Registry fields beyond `02`

**Decision:** The registry schema adds `summary` (hub-row line, ≤ 48 chars), `willDo` (2-4 lines for the coming-soon page) and `crossOriginIsolated`; `engine` becomes `engines[]`, because hybrid tools have a client and a server engine (P07 is `image-ml` + `image-ml-server`). `accepts`, `outputs`, `limits`, `howTo` and `faq` are optional for `soon` tools and required for `live`/`beta`. `02` is updated to match.
**Why:** the design's hub rows and coming-soon page show a short line and a numbered "what it will do" list; `soon` tools have no real limits or FAQs yet, and inventing them would break the "numbers are true" rule.
**Reverse:** drop the fields from `schema.ts` and the entries, or make the optional ones required.

## 2026-09-29 · Tool copy written from the specs

**Decision:** All 75 entries were written from `tools/*.md`: SEO queries from each **SEO:** line, `willDo` from **Does/Controls**, numbers as the spec gives them. Where the spec's H1 phrase differs from the tool name (P12 "Instagram Image Resizer", P18 "JPG to PDF" …), the H1 follows the primary query. Where the design names a tool or its hub line differently (V06 "Extract Audio", P02 "Free, ratio presets or exact px" …), the design wins. Credit prices are not printed in copy (the README calls them placeholders); server tools are never called free.
**Why:** `09` → Page template (H1 = primary search phrase); the design is signed off.
**Reverse:** edit the entries in `packages/registry/src/tools/`.

## 2026-09-29 · Hub order, runtime tags and "AI"

**Decision:** Hubs list working tools first and `soon` tools last, each group by wave, then README order. A tool is "AI" when one of its engines is an ML engine, so P12 Blur (automatic face detection) counts: the photo hub's AI filter shows 4, not the design fixture's 3. Runtime tags: `BROWSER`, `AI · BROWSER`, `AI · CREDITS`, `CREDITS`. "Most used" on the home page is the design's fixed list until analytics can rank tools.
**Why:** `02` → Status behaviour; truthful counts; `03` → Layout ("start with a fixed list").
**Reverse:** `hubOrder`, `isAi`, `runtimeTag` and `MOST_USED` in `packages/registry/src/index.ts`.

## 2026-09-29 · Search

**Decision:** Search ranks exact phrase > phrase prefix > contains > all typed words (the last may be half-typed) over the tool name, primary query, secondary queries and H1. A tool ranks above the conversion pairs it powers, which reproduces the home design ("mp4 to gif": Video to GIF, MP4 to GIF, GIF to MP4). Conversion pairs join the index only once their tool is live or beta. Search results link to `soon` placeholder pages; hub rows for `soon` tools are not links (design and `02`).
**Why:** the design's example result order; `12` → M2 (pair pages only for live tools).
**Reverse:** `packages/registry/src/search.ts`.

## 2026-09-29 · Tokens and the Tailwind theme

**Decision:** `docs/design/tokens.css` is copied to `packages/ui/tokens.css` unchanged apart from Prettier formatting. `packages/ui/theme.css` mirrors every token in Tailwind v4's `@theme inline` (`bg-surface` → `var(--surface)`) and removes Tailwind's default palette, type scale, radii and weights, so an off-token colour or size doesn't compile to anything. A test reproduces the handover's contrast table from `tokens.css` (±0.15) and checks focus ring, strong border and media overlays too.
**Why:** `03` → Tokens ("mirrored in Tailwind config", "CI runs a contrast check on the token table").
**Reverse:** edit `theme.css`; the token names are the contract.

## 2026-09-29 · Where the design screens and the handover README disagree, the screens win

**Decision:** Three places: the "Until then, try" hatch lines are drawn in `--bg` (README: `--border`); the tool tagline is 16.5 px (README: 18); the `AI · BROWSER` hub tag is in the accent (not in rule 1's list). The theme also carries the half-step sizes the screens use (11, 11.5, 12.5, 13, 13.5, 14.5, 15, 15.5, 16.5, 17, 22, 26, 34) and the body uses the fonts' normal line height, as the screens do.
**Why:** the task is to match the PNGs at 1440 and 390 px; they were rendered from the reference HTML, which is the measurement source.
**Reverse:** `hatch` utility and sizes in `packages/ui/theme.css`, `Tag` tone in `HubList`.

## 2026-09-29 · Shared components and the ToolShell

**Decision:** `packages/ui` has every component in `03`'s table. The ToolShell renders all six `ui` types from a registry entry plus a preset (options, copy, output naming), against the engine contract from `02`, which now lives in `packages/engines` with a dummy engine for M1. The canvas editor, timeline and batch list are working shells (modes, 50-step undo, zoom, in/out handles with I/O and frame keys, per-file status); their pixel work comes with the engines in M2. Calculators get a placeholder aspect-ratio calculator until their own presets land. Components import `next/link` directly (only `apps/web` uses them); a plain `<a>` is used for routes that need cross-origin isolation.
**Why:** `12` → M1 ("ToolShell with all `ui` types working against a dummy engine"); `03` → Shared components.
**Reverse:** per component.

## 2026-09-29 · Theme choice

**Decision:** System / Light / Dark as a segmented control in the footer and in the phone menu. The choice is stored in localStorage as `etb-theme` (not `theme`, to avoid clashing with anything else on the origin), and an inline script applies it before first paint. Nothing is stored for "System".
**Why:** `03` → Tokens ("manual toggle stored locally"); the design doesn't draw a toggle, and the footer is the calmest place for it.
**Reverse:** `ThemeToggle` and `themeScript` in `packages/ui`.

## 2026-09-29 · Site skeleton routes

**Decision:** One `[slug]` route renders the 6 hubs and the 75 tool pages, all statically generated from the registry (`dynamicParams = false`); `disabled` tools get no page, so the host answers 404 (a "retired tool" page can come with the first retirement). Every page renders its own header, so the current category is marked on the server with no client JS. `soon` pages are `noindex`. While none of a tool's related tools works yet, the "Until then, try" panel becomes "More photo tools" with the hub and search as rows, rather than linking to more placeholders. Home "Most used" rows link to their pages and aren't dimmed, even while `soon`; hub rows follow the design (dimmed, not links). A `/sign-in` stub says accounts come later. Legal pages are marked drafts; `/contact` publishes no address until Go public (no domain yet); `/licenses` is generated from `licenses.json` (approved, non-dev entries).
**Why:** `09` → URL scheme; `02` → Status behaviour; `08` → Pages to ship (stubs in M1, final text is off-limits until Go public).
**Reverse:** `apps/web/src/app/[slug]/page.tsx`, `components/ComingSoon.tsx`, the page files.

## 2026-09-29 · Search loads on first use

**Decision:** The build writes the search index to `/search-index.json` (≈ 20 KB); the header search (`/` or the button) and the home search load it on first focus, so it's never in the initial JS. On desktop the home search takes focus on load (the search line is the hero); on touch screens it doesn't, so no keyboard pops up.
**Why:** `10` → Initial JS budget; design README → Home.
**Reverse:** `packages/ui/src/layout/useSearch.ts`, `apps/web/src/components/HomeSearch.tsx`.

## 2026-09-29 · Fonts

**Decision:** Onest (variable) and IBM Plex Mono 400/500 come from the Fontsource packages through `next/font/local`, one call per subset (Latin, Latin-ext, Cyrillic, Cyrillic-ext) with its `unicode-range`, so pages only fetch the subsets their text uses and file names are content-hashed. Only Onest Latin is preloaded; it gets a metric-matched Arial fallback against layout shift. The Latin subset carries U+02BB and U+2018; Cyrillic-ext carries Uzbek қ ғ ҳ.
**Why:** `10` → Loading strategy; `03` → Tokens.
**Reverse:** `apps/web/src/app/fonts.ts` and the stacks in `globals.css`.

## 2026-09-29 · A workshop instead of Storybook or Ladle

**Decision:** The design screens (and, in M1b, the component gallery) live in the app itself as `*.workshop.tsx` routes, compiled only when `ETB_WORKSHOP=1` (`pnpm workshop`), so they use the real fonts, tokens and components and never reach a production build. `pnpm design:compare` screenshots each screen at the PNG's size and theme next to the design PNG.
**Why:** Ladle is unmaintained since November 2025 and pinned to Vite 6; Storybook adds a large second build toolchain for what a few routes do. `12` asks for the components "in Storybook/Ladle"; the gallery covers the same need.
**Reverse:** add Storybook with `@storybook/nextjs` and move the gallery into stories.

## 2026-09-29 · Sample image and icon

**Decision:** The Remove Background sample and the design screens use a mug scene drawn in CSS (`scripts/samples/mug.html`) and rendered to `public/samples/mug.jpg` and `mug-cutout.png` with `pnpm samples`: ours, license-free, and the same picture the design shows. On phones one sample serves both sizes, so the mug looks smaller than in the phone PNG. The favicon is a placeholder monogram until open question 1 settles the logo.
**Why:** `CLAUDE.md` → fixtures are small, license-free, generated where possible; `09` → example images are ours.
**Reverse:** replace the files; `pnpm samples` re-renders them.

## 2026-09-29 · Hash-based CSP on static pages, proven

**Decision:** Every exported page gets its own `<meta http-equiv="Content-Security-Policy">`, written after `next build` by `apps/web/scripts/postbuild.ts`: `script-src 'self'` plus the sha256 of each inline script on that page (theme, Next's bootstrap and payload), Next's script files carry SRI `integrity` (`experimental.sri`), no `'unsafe-inline'` for scripts, no nonces. `'wasm-unsafe-eval'` is added only on working tool pages whose engines compile WebAssembly (`needsWasm` in the registry). Header-only directives (`frame-ancestors 'none'`), `nosniff`, referrer and permissions policy, HSTS and immutable caching for `/_next/static/*` are in `_headers`, which the build emits from `apps/web/src/lib/headers.ts` and `pnpm preview` applies like Pages. COOP/COEP are set only on `/video-converter` (from the registry). Proof, in Chromium against `pnpm preview`: zero violations on home, a hub, a coming-soon page, the isolated route, legal pages, 404, the search overlay and a client-side navigation; `crossOriginIsolated` is true on `/video-converter` when reached from the home search. The `'unsafe-inline'` fallback in `11` is not needed. `style-src` keeps `'unsafe-inline'` for React style attributes; we render no user HTML.
**Why:** `11` → CSP ("M1 must prove a static tool page loads with zero CSP violations").
**Reverse:** drop the postbuild step and set a header CSP with `'unsafe-inline'` in `headers.ts`.

## 2026-09-29 · SEO scaffolding

**Decision:** Every page's metadata comes from the registry through one helper (title, description, canonical, Open Graph, `summary_large_image` Twitter card); `soon` tools are `noindex`. JSON-LD: `WebSite` on home, `BreadcrumbList` on hubs and tool pages, and for working tools `WebApplication` (+ `FAQPage` when the page has an FAQ); placeholders get only the breadcrumb. `robots.txt` allows everything but `/admin`, `/api`, `/account` and points at the sitemap; the sitemap lists home, hubs, legal pages, working tools and their conversion pairs, so in M1 it has no tool pages. Open Graph images (1200 × 630) are rendered at build for home, every hub and every tool from one dark Signal template whose colours are read from `tokens.css`; `@fontsource/onest` supplies static Onest weights, because the renderer can't read WOFF2 or variable fonts. The export writes the images without an extension, so the post-build step renames them to `.png` and fixes the references. No `SearchAction` in the `WebSite` data until the home page reads `?q=`. The host check ignores the `https://schema.org` vocabulary, like XML namespaces.
**Why:** `09` → Page template, Technical SEO.
**Reverse:** `apps/web/src/lib/seo.tsx`, `lib/og.tsx`, `app/robots.ts`, `app/sitemap.ts`.

## 2026-09-29 · PWA: manifest, icons, service worker

**Decision:** `manifest.webmanifest` (standalone, dark `--bg` colours) with 192/512 px, maskable and Apple touch icons drawn at build from the dark tokens (placeholder monogram until the logo is decided). A hand-written service worker, generated after the build so its precache list matches the hashed files: the home and offline pages plus every script, style and font they load; pages network-first with the cached copy and then `/offline` as fallbacks; `/_next/static/*` cache-first; models and WASM (`/models/*` or the `MODELS_BASE_URL` origin) cache-first in their own unversioned cache so a model downloads once. Registered in production builds after `load`. Verified by stopping the server: visited pages still open and others show the offline page. No Workbox (one more dependency for ~60 lines).
**Why:** `12` → M1 ("PWA manifest + service worker (app shell precache)"); `10` → models "cached by the service worker".
**Reverse:** delete `scripts/sw.ts` and the registration; ship a worker that unregisters itself for existing visitors.

## 2026-09-29 · Cookieless analytics: our own sender, off by default

**Decision:** Page views (on every route change), the `09` event list and real-user Web Vitals go to a self-hosted, Umami-compatible collector (`POST {ANALYTICS_URL}/api/send`) through ~60 lines of our own code, not Umami's script: no cookies or storage, no identifiers, URLs without query strings, referrer as an origin only (internal ones dropped), file sizes and durations only as buckets, and nothing at all under Do Not Track or Global Privacy Control. It's off unless both `ANALYTICS_URL` and `ANALYTICS_WEBSITE_ID` are set at build time (validated as a pair); the post-build step adds that origin to `connect-src`. The ToolShell emits the tool events already bucketed. Running a collector is a hosting question for Go public; nothing is installed.
**Why:** `09` → Measuring; `CLAUDE.md` rule 7; `10` → real-user Web Vitals.
**Reverse:** leave the variables unset (sends nothing), or swap `apps/web/src/lib/analytics.ts` for another collector's API.

## 2026-09-30 · Initial JS budget: 150 KB, not 120 KB

**Decision:** The shell's initial JS budget is 150 KB gzip (module scripts, before any engine), enforced in CI by `apps/web/scripts/js-budget.ts` on five pages. Measured on the M1 shell: 143–144 KB, of which React 19 and the Next.js 16 runtime are about 120 KB on their own and our code (header, search, theme, analytics, service worker registration) about 24 KB. The legacy `nomodule` polyfill (38 KB) is excluded: browsers that run modules never load it.
**Why:** `12` → M1 ("if the framework alone takes most of it, re-set the budget … now rather than discover it in M2"). The framework alone already takes the whole 120 KB. This is the one budget change made without sign-off; flagged at checkpoint 2.
**Reverse:** lower `BUDGET_KB`; getting under 120 KB means leaving the Next.js client runtime (e.g. plain server-rendered pages with islands), a stack change.

## 2026-09-30 · Tests and budgets in the required CI job

**Decision:** The required "JS · …" job now also runs the initial-JS budget, Lighthouse on five pages (home, a hub, a coming-soon page, the isolated route, a legal page; mobile emulation, simulated slow 4G) through `scripts/lighthouse.ts` and the `lighthouse` package directly, because `@lhci/cli` 0.15 pulls Lighthouse 12 with audited-vulnerable `extract-zip` and `tmp` and Playwright on Chromium, Firefox, WebKit and a phone viewport against the production build with the workshop: zero CSP violations, cross-origin isolation after arriving from the home search, axe (WCAG 2.2 AA, no serious or critical issues) on every page type in light and dark, keyboard (`/`, Esc cancels a run, skip link, arrow keys), every internal link resolves, all 75 tool pages exist and are `noindex`, theme persistence and each ToolShell demo. Lighthouse gates: performance ≥ 0.9, accessibility ≥ 0.95, best practices ≥ 0.9, lab LCP ≤ 2.5 s, CLS ≤ 0.05, TBT ≤ 150 ms, script transfer ≤ 160 KB. Local run: performance 0.98–0.99, accessibility 1.00, CLS ≈ 0, TBT ≤ 82 ms, LCP 1.8–2.4 s. Lab LCP is simulated on a slow 4G, 4× slower CPU; the 1.8 s p75 real-user budget in `10` is watched through the Web Vitals analytics events. Reports stay on disk, never uploaded. `pnpm preview` now compresses like Pages (Brotli/gzip), so transfer sizes are realistic.
**Why:** `12` → M1 (Playwright proofs, axe, Lighthouse budgets); the ruleset's required checks are fixed, so the gates live inside one of them.
**Reverse:** move the steps to their own job (then it isn't required unless the ruleset changes).

## 2026-09-30 · Axe over the drawing: dimmed "soon" rows

**Decision:** `soon` tool names on hubs use `--text-muted` alone, not `--text-muted` at 60 % opacity as drawn: the drawn version fails WCAG AA contrast (axe, serious). They still read as dimmer than working tools, which are in `--text`. The search overlay's options are now the links themselves (`role="option"`), fixing a nested-interactive issue.
**Why:** `CLAUDE.md` rule 9 (WCAG 2.2 AA) is non-negotiable.
**Reverse:** none intended.

## 2026-09-30 · ESLint plugins still not on ESLint 10

**Decision:** Checked at the end of M1: `eslint-plugin-react` 7.37.5, `eslint-plugin-jsx-a11y` 6.10.2 and `eslint-plugin-import` 2.32.0 still declare ESLint ≤ 9. The tracked item carries forward to M2; axe in Playwright stays the accessibility gate (now in CI on every page type).
**Why:** `12` → M1 tracked item ("carry forward if still blocked").
**Reverse:** add the plugins to `eslint.config.mjs` once they support ESLint 10.

## 2026-09-30 · Live tool page template

**Decision:** A `live` or `beta` tool page is its view (from `apps/web/src/tools`) right under the header, filling the first screen, then four hairline sections whose headings sit in the 560 px settings column: "How to use the {name}" (`seo.howTo`), "Why use this", "Questions" (`seo.faq`), "Related tools". "Why use this" is three plain lines built from the registry (speed from `ui`/`runtime`, privacy from `runtime`, cost from `cost`), so it is true per tool and never written twice. Related tools are the registry's picks that work today, topped up from the same category, then the category hub. JSON-LD: `WebApplication`, `BreadcrumbList`, `FAQPage`.
**Why:** `09` → Page template; design README → Rules (hairlines over boxes, 3 text levels); `03` → AI tells (no three icon boxes).
**Reverse:** `apps/web/src/components/ToolDetails.tsx` and `apps/web/src/lib/tool.ts`.

## 2026-09-30 · Calculators: state in the URL, no files

**Decision:** Calculator inputs live in the query string (`?width=1080&height=1920`), written with `history.replaceState` 300 ms after typing stops (Safari throws after 100 history calls in 30 s, and a Back entry per keystroke is useless). Only values that differ from the defaults are written; unknown keys are ignored and unknown choices fall back to the default. Every result has a copy button, and "Copy link" copies the page URL with the inputs. Calculators (`ui: 'calculator'`) don't need `accepts`, `outputs` or `limits` to go live, since they take no files; the schema and `02` say so.
**Why:** `tools/subtitles-and-time.md` → shared rules (shareable state in the URL, no storage, copy buttons).
**Reverse:** `apps/web/src/tools/url-state.ts`; the schema rule in `packages/registry/src/schema.ts`.

## 2026-09-30 · Tool views load per page

**Decision:** Each tool view is a client component loaded with `next/dynamic` from one small client map (`apps/web/src/tools/index.tsx`), typed against the id list in `tools/ids.ts` that server code checks. The view is still prerendered, but its code is a separate chunk that only its own page loads: a static map put every tool's code on every hub and tool page (+8.6 KB with three calculators). The shell stays at 143–146 KB on every page type; a calculator's own chunk adds about 6 KB after it, which counts as the tool, not the shell. The JS budget and Lighthouse now include `/timecode-calculator` (Lighthouse drops `/privacy`, keeping five pages). The build also writes `/favicon.ico` (browsers ask for it even with an SVG icon, and the 404 was a console error on every first visit).
**Why:** `10` → Budgets (initial JS before the engine loads); `CLAUDE.md` rule 1 (speed).
**Reverse:** import the views statically in `src/app/[slug]/page.tsx` (every page pays for every tool).

## 2026-09-30 · Color Converter: our own maths, CSS notation out

**Decision:** C03 has no dependency: `packages/core/src/color` parses what people paste (HEX with or without #, 3/4/6/8 digits, `rgb()`/`rgba()` in comma or space syntax, bare `255, 99, 71`, `hsl()`, `hsv()`/`hsb()`, `cmyk()`, `lab()`, `oklch()`, the 148 CSS names) and prints paste-ready CSS syntax. Lab is CIE Lab with a D50 white (what CSS `lab()` and Photoshop use); Oklch follows Ottosson as CSS does; matrices come from CSS Color 4. HSL/HSV print one decimal, which round-trips every tested colour exactly (the fixture list, all 148 names and 4,096 colours across the cube); Lab/Oklch round-trip within one 8-bit step. CMYK is the naive formula, labelled "approximate, not color-managed". The nearest name uses Oklab distance. Tints and shades mix with white/black in linear light, 20 % steps. Colours outside sRGB are clipped and flagged. The input lives in the URL (`?c=`), like the other calculators. Long values use a new one-column `FactList` (label, mono value, copy button) instead of the two-column number grid.
**Why:** `tools/color.md` → C03 and shared rules (linear light for blending, copy button per format).
**Reverse:** swap `packages/core/src/color/color.ts` for a library such as culori (MIT) behind the same functions.

## 2026-09-30 · QR Code Generator: `qrcode` for the matrix only, state in memory

**Decision:** U01 uses `qrcode` 1.5.4 (MIT) only to build the module matrix (UTF-8 byte mode). The drawing is ours: one set of path strings in module units renders both the SVG (a single file with a background rect and two paths, no scripts, no external references) and the PNG (the same paths through `Path2D` on a canvas, 512-4096 px). A logo is redrawn onto a 256 px canvas first and embedded as a PNG data URL, so the SVG never carries the user's file as-is; it clears the centre 22 % of the code and forces level H. `@etb/core/qr` is its own entry point, so `qrcode` only loads on this page. Unlike the calculators, the QR inputs are **not** written to the URL: Wi-Fi passwords and contact details don't belong in shareable links or browser history. On phones a bottom bar shows the code and "Download PNG" while the form is on screen and the preview isn't. Wi-Fi codes use the `WIFI:T:…;S:…;P:…;;` format with `\ ; , : "` escaped; "WPA3" writes `T:SAE`, which older phones may not know (WPA or WPA2 is the default). Tests decode every content type at L/M/Q/H, and with a logo at H, with jsQR (Apache-2.0, tests only); the e2e test decodes the downloaded PNG.
**Why:** `tools/utility.md` → U01; `docs/13` listed `qrcode` and jsQR for exactly this; `CLAUDE.md` rule 4 spirit (no user data where it isn't needed).
**Reverse:** replace `qrMatrix` with another encoder; the drawing doesn't depend on it.

## 2026-09-30 · Subtitle Converter: tolerant in, strict out, every loss reported

**Decision:** T01 reads SRT, WebVTT, ASS, SSA and SBV (detected from the content, the extension only breaks ties) and writes SRT, WebVTT, ASS, SBV and TXT. All logic is in `packages/core/src/subtitles`, so the panel can reuse it. A cue keeps only times in whole milliseconds, text with line breaks, and `<i>`, `<b>`, `<u>`; everything else is removed at parse time and counted, and the result lists it in plain words ("1 style override removed", "3 cue position settings removed"). ASS `{\i1}` `{\b1}` `{\u1}` and italic/bold styles become tags unless "Italic and bold: Remove" is picked. Output is UTF-8 with `\n` line endings, and a BOM on request. Input encoding is detected: BOM, UTF-16 by its zero bytes, strict UTF-8, else Windows-1251 when most letters are in 0xC0-0xFF, else Windows-1252; "Read as" overrides it. SRT → ASS uses one default style (white Arial 64 px on 1920 × 1080, 3 px outline, bottom centre) that people edit in Aegisub: the spec's "editable" is met by the file, not by a style editor in the tool. TTML/DFXP (spec: "Wave 2 addition if cheap") and TXT input (no timings) are not offered. Fixtures in `fixtures/subtitles/` are hand-written; `messy.srt` is kept byte for byte (`.gitattributes`) for its BOM and CRLF.
**Why:** `tools/subtitles-and-time.md` → T01 and shared rules.
**Reverse:** per format in `packages/core/src/subtitles/parse.ts` and `write.ts`.

## 2026-09-30 · ToolShell for real file tools

**Decision:** First real engine behind the ToolShell, so it gained what T01 needed and later tools will too: engines can return `notes` (shown under "What changed") and `details` (extra readout facts, written so the value reads alone: "4 cues", "ASS → VTT"); `preview: 'text'` shows the start of a text output instead of a file card; form tools with `multiple` switch to the batch list when several files arrive, keep every output, and offer per-file download plus "Download all · ZIP" (fflate, MIT, loaded only on that click); a converter keeps the file name and changes the extension (`episode 1.srt` → `episode 1.vtt`). The how-to list lets long steps wrap; single-line steps are unchanged, so the signed-off screens still match.
**Why:** `docs/02` → ToolShell (batch, result panel, report what was dropped); `CLAUDE.md` rule 2 (no one-offs: this lives in the shared shell, not the tool).
**Reverse:** the pieces are independent in `packages/ui/src/tool/ToolShell.tsx`.

## 2026-09-30 · Conversion pair pages

**Decision:** `/convert/<from>-to-<to>` is its own route. It renders the converter with the target preset (`to`), the pair's own H1, tagline and how-to, then an "About FROM and TO" section, how-to, why, FAQ, the sibling pairs and related tools. The copy lives in `packages/registry/src/pairs.ts`, one entry per pair, and a registry test fails if a pair whose tool works has no copy, or if two pairs share their "About" text. A pair page exists only once its tool works: it is in the sitemap and search, and has its own Open Graph image and canonical URL. The converter's own page links to its pairs under "Conversions". Live now: srt-to-vtt, vtt-to-srt, ass-to-srt.
**Why:** `docs/09` → URL scheme (unique copy per pair, canonical to itself) and Quality rules (no page without a working tool, no near-duplicates); `docs/12` → M2 (pairs only for live tools).
**Reverse:** drop the route; the registry copy is unused without it.

## 2026-09-30 · Lighthouse budgets read the median of 3 runs

**Decision:** `pnpm lighthouse` runs each of the 5 pages 3 times and checks the budgets against the median run, picked the way Lighthouse picks it (closest to the median FCP and TTI). The saved report is that run. The budgets themselves are unchanged.
**Why:** one simulated mobile run swings LCP by a few hundred ms; `/photo` failed at 2530 ms on a PR that didn't touch it and passed at 1814 ms on the median. Lighthouse's variability guide recommends the median of several runs. It costs about a minute of CI time.
**Reverse:** set `RUNS = 1` in `scripts/lighthouse.ts`.

## 2026-09-30 · Image engine: browser decode, jSquash encode, in a worker

**Decision:** `image-codec` (P05, P06) runs in a Web Worker. The main thread checks the file first: format by magic bytes, 200 MB, and 100 MP from the header before anything is decoded. The worker decodes with `createImageBitmap` (EXIF orientation applied, colors converted to sRGB) and encodes with the jSquash WASM builds: MozJPEG, libwebp, libavif, the png crate and OxiPNG. The worker is replaced on cancel, since an encode can't be interrupted. Only the single-threaded codec builds are imported: the threaded AVIF and OxiPNG builds spawn workers that import themselves, which hung the Turbopack build, and threads need SharedArrayBuffer, which only the isolated video route has. The `.wasm` files are bundler assets: content-hashed under `/_next/static/media`, immutable and cached by the service worker, each under 3.5 MB. `MODELS_BASE_URL` stays for ML models and files too big for static hosting (docs/10 says WASM loads from there too; for these small, versioned files the bundler gives the same caching without a copy step). AVIF's quality scale sits lower than JPEG's, so the slider value minus 25 is passed to libavif (85 → 60).
**Why:** `tools/photo.md` → shared rules and limits; `10` → responsiveness (encodes of 1-3 s would block the page); `CLAUDE.md` rule 1.
**Reverse:** fetch the `.wasm` from `modelUrl()` and hand the compiled module to each codec's `init()`; or move the work back to the main thread.

## 2026-09-30 · Photo input, output and metadata in M2

**Decision:** Input is whatever the browser decodes: JPG, PNG, WebP, AVIF, GIF (first frame) and BMP everywhere, TIFF and HEIC only where the browser can (Safari); elsewhere the tool says so plainly. No libheif: open question 10 (HEVC patents) is unsettled, and its fallback says to use the browser's decoder where one exists. So the `heic-to-jpg` and `heic-to-png` pair pages are held (`hold` in `conversions.ts`), along with `png-to-ico` until ICO output (Wave 3). Output is JPG, PNG, WebP, AVIF and BMP. GIF output arrives with V04's GIF encoder and TIFF output later; the copy only promises what works. Colors are converted to sRGB and ICC profiles aren't kept (a "keep profile" option waits for a real need). Metadata follows `tools/photo.md`: by default the EXIF camera and copyright data stay and the GPS location is removed (the GPS IFD is zeroed, not just unlinked), orientation is reset to 1, and it's written back into JPG (APP1), PNG (eXIf) and WebP (EXIF chunk, turning a simple file into VP8X). AVIF and BMP output carry none, and the result says so. "Remove all" drops everything. Compress to a target size binary-searches quality 40-95 in 8 encodes, keeps the best result under the target, and suggests a smaller longest side when quality 40 is still too big. A same-format recompress never hands back a bigger file: you get the original, unless it carries a GPS location or you asked to remove metadata.
**Why:** `tools/photo.md` → P05, P06 and shared rules; `docs/14` → question 10; `docs/09` → Quality rules (no page without a working tool).
**Reverse:** add libheif as a separate lazy file once question 10 is answered, then drop the `hold` on the HEIC pairs.

## 2026-09-30 · ToolShell settings beyond segmented controls

**Decision:** A preset option can be a `slider` or a `number` with its unit, as well as the default segmented choice, and can show only while another option has certain values (`when`). This covers quality for lossy formats only, and target size only in target mode. Phone settings rows summarize them ("80", "500 KB"). Presets can cap a batch (`maxFiles`: 50 for photos). The download label and file extension come from the engine's real output, so "Keep format" downloads as what the file actually became.
**Why:** `tools/photo.md` → P05 controls (quality slider, target size in KB); `CLAUDE.md` rule 2 (the shell grows, tools don't ship their own controls).
**Reverse:** in `packages/ui/src/tool/ToolShell.tsx`.

## 2026-09-30 · Crop and Resize: geometry in the image worker, a real crop box

**Decision:** P02 Crop and P03 Resize run on `image-geometry`, pure TypeScript in `packages/engines/src/image/geometry.ts`, inside the same worker as the codecs (decode → turn → crop → resize → pad → encode). Crops, quarter turns and flips copy pixels, so they are lossless. Resizing is a separable filter on premultiplied alpha (no dark fringes at transparent edges): Lanczos-3 by default, plus Bicubic (Catmull-Rom), Bilinear and Nearest for pixel art. Coefficients follow Pillow's, and a ring of filtered rows keeps memory at a few rows (12 MP → 3 MP in about 1 s). We wrote it rather than adding `@jsquash/resize`: no new dependency, license check or WASM file, and it is unit tested in Node. Output is capped at 100 MP and 30,000 px a side.
- **Crop:** the W × H fields set the box in source pixels, and Crop never resamples. "Exact 1080 × 1350" means a 1080 × 1350 px box, placed anywhere. To get all of a bigger photo at 1080 × 1350, crop to 4:5, then resize; the FAQ says so.
- **Batch crop:** crops each image to the ratio, centered. It needs a ratio, so Free blocks the batch and the tool says why. Per-image adjust in a batch waits for later.
- **Resize:** "lock ratio" is the Fit choice. Keep ratio (the default) fits inside the box. Pad, Fill and Stretch give the exact box. Presets (HD, Full HD, 4K, square, Story, YouTube thumbnail) are entries in the Resize to list. Enlarging past 100 % works, with a note that it adds no detail. The optional "target file size" is left to Compress Image, which the result links to. Output keeps the input's format by default, at quality 90 for lossy formats.
**Why:** `tools/photo.md` → P02, P03 and shared rules (lossless geometry, transparency, batch); `CLAUDE.md` rule 1 (browser first) and rule 6 (fewer dependencies to check).
**Reverse:** swap `resample` for `@jsquash/resize` behind the same signature; per-image batch crop adds a box per file in the batch list.

## 2026-09-30 · CanvasEditor crop mode and ToolShell for editor tools

**Decision:**
- **Crop box:** CanvasEditor draws the real image, turned and flipped as edited, with a crop box that has 8 handles (24 px targets or larger), thirds lines and its size in px.
  - Drag to move; handles resize from the opposite side and keep a locked ratio.
  - The box is focusable, and arrow keys move it (Shift: 10 px).
- **Fields:** width, height, X, Y and Center are number fields in the settings. On phones they sit in a "Crop box" sheet.
- **State:** the edit (turns, flip, box) lives in the page (`useEditor`), so the box and the fields are the same state. It has undo and redo (50 steps, one step per drag or per field).
  - Rotate 90° and Flip are actions. Zoom is hidden on phones, which pinch to zoom.
- **Box logic:** fit to a ratio, drag, typed sizes and turns are pure functions in `crop.ts`, with tests.
- **ToolShell additions:**
  - `select` options, for long lists such as ratios and presets;
  - `editor.ratio`, which reads the ratio lock from the options;
  - `result: 'output'`, which shows the result alone when its shape changes;
  - `blocked`, the reason a run can't start;
  - a "Back to the editor" link after a crop.
- **Select primitive:** it gained a visible chevron and a fixed width.
**Why:** `docs/03` → CanvasEditor (presets open one mode, undo 50 steps); `docs/12` → M2 (crop mode now, other modes with P01/P09/P10); WCAG 2.2 AA (keyboard alternative to dragging, target size).
**Reverse:** the pieces are independent: `packages/ui/src/tool/{CanvasEditor,CropFields,crop,useEditor}.ts(x)`.

## 2026-09-30 · Video engine: WebCodecs through Mediabunny, codecs from the browser

**Decision:**
- **Engine:** the video tools run on Mediabunny 1.60 (MPL-2.0), which reads and writes MP4, MOV, WebM, MKV, MP3, WAV, OGG, FLAC and ADTS, and drives the browser's own WebCodecs decoders and encoders. Nothing is uploaded.
- **Codecs we ship:** none for H.264, H.265 or AAC (open question 10's default: codecs come with the browser).
  - Where a browser can't encode H.264, or AAC audio that needs re-encoding, the output is WebM (VP9 + Opus), and a note names the browsers that can.
  - Opus never goes into an MP4.
  - AAC audio is copied, not encoded, whenever the container allows, so most MP4 work needs no AAC encoder.
- **Encoders of our own:** MP3 (LAME) and FLAC (libFLAC) come as WASM through `@mediabunny/mp3-encoder` and `@mediabunny/flac-encoder`, imported only when those formats are picked.
  - LAME is LGPL, so it stays its own lazy chunk, with a source offer on `/licenses`. The register's new `sourceOffer` field lists conditional entries that ship there.
- **Probing:** a file is read as it arrives: length, frame rate (variable frame rate detected), codecs, rotation, HDR, and whether this browser can decode it. The settings show "256 × 144 px · 30 fps · H.264 + AAC", and warnings (VFR, HDR, can't decode, long video on a phone) show before starting.
- **Timeline:** real thumbnails, a preview player that follows the playhead and handles, and In/Out fields you can type into ("1:02.5").
- **Results:** play inline.
- **Fixtures:** two 30 s synthetic clips (FFmpeg test pattern, a beep each second, keyframes every 2 s) in `fixtures/video/`, one H.264 + AAC MP4 and one VP9 + Opus WebM. The test browsers lack H.264 and AAC, and copy paths are unit-tested in Node, where Mediabunny needs no codecs.
**Why:** `tools/video.md` → shared rules; `docs/14` → open question 10; `docs/13` → LGPL only as a separate, swappable file.
**Reverse:** swap the codec choice in `packages/engines/src/video/media.ts` → `pickOutput`; add `@mediabunny/aac-encoder` there if question 10 allows it.

## 2026-09-30 · Trim Video and Extract Audio in M2

**Decision:**
- **Trim Fast:** copies the streams from the keyframe at or before In (Mediabunny packet lookup), so the clip can start up to one keyframe interval early (±1 GOP, as the spec's tests allow). The result names the real start ("starts at the keyframe at 10.0 s, 0.50 s before your In point").
  - We chose this over MP4 edit lists that hide the pre-roll: players and editors treat edit lists unevenly, and WebM has none.
- **Trim Precise:** re-encodes the video, frame-exact, and copies the audio when it fits.
- **Deferred to M2b, with smart cut:** keeping or removing several ranges and joining them (the V01 spec's multi-range join with 10 ms crossfades). It needs a multi-range timeline and a re-encoding joiner. The page copy no longer promises it, and its FAQ says it's coming.
- **Extract Audio:** copies when the codec matches: AAC into M4A, AAC into a raw .aac (our own ADTS writer, since Mediabunny would re-encode), Opus into OGG, MP3 into MP3. Otherwise it decodes and encodes.
  - The track picker appears only for files with several audio tracks (ToolShell `probed` options, whose choices come from the file).
  - The optional range stays out of the UI for now; the engine takes start and end, and Trim covers it.
- **Pair pages:** `mp4-to-mp3` and `mov-to-mp3` go live with their own copy.
**Why:** `tools/video.md` → V01, V06 and Fast vs precise; `CLAUDE.md` rule 10 (pick the default, log it, keep going).
**Reverse:** multi-range and smart cut land together in M2b (`docs/12`); the ADTS writer goes if Mediabunny copies AAC into ADTS itself.

## 2026-09-30 · Compress Video and Video to GIF in M2

**Decision:**
- **Compress, size target:**
  - "MB" means 1,000,000 bytes, so "under 25 MB" holds whichever way a site counts.
  - The video bitrate comes from the spec's formula. Copied AAC counts at its measured bitrate; re-encoded audio at 128 kbps AAC or 96 kbps Opus.
  - Below 0.05 bits per pixel per frame (0.035 for H.265 and AV1), Auto resolution steps down (1080p → 720p → …) and says so.
  - Encoding asks for constant bitrate. WebCodecs has no two-pass, so up to two more passes correct the video's share when a pass overshoots, and they stop once the encoder won't go lower at that size, with a note to pick a lower resolution.
  - The estimate before starting is the target itself ("Just under 25 MB").
- **Compress, quality mode:** uses Mediabunny's High/Medium/Low levels. If the result isn't smaller, the original comes back with a note.
- **Compress, codecs:** H.265 and AV1 fall back to H.264 where the browser can't encode them, with a note. The server path (M4/M5) stays off, as the milestone says for hybrid tools.
- **GIF, making it:** our own quantiser: median cut on a 5-bit histogram of every frame, refined with k-means, 255 colors, plus serpentine Floyd–Steinberg dithering (on by default).
  - Frames are differenced: unchanged pixels become transparent, each frame is cropped to what changed, and a frame with no change lengthens the one on screen.
  - LZW and GIF89a are written in a worker; delays are spread in centiseconds so 12 fps averages right.
  - Per-frame palettes are an option.
- **GIF, WebP option:** animated WebP from libwebp frames (jSquash) muxed into ANMF chunks.
- **GIF, limits and estimates:** at most 600 frames and about 400 MB of frame memory, with a clear message above that. The estimate before starting is frames × width × height × 0.45 bytes (× 0.35 for WebP), flagged above 15 MB.
- **GIF, loops:** loop count is Forever / Once / 3 times; browsers read GIF repeat counts slightly differently.
- **Pair pages:** `mp4-to-gif` and `mov-to-gif` go live with their own copy.
**Why:** `tools/video.md` → V02, V04; the spec's own formula, bits-per-pixel rule and in-house quantiser (no ffmpeg.wasm in the launch set).
**Reverse:** `packages/engines/src/video/compress.ts` (`planCompress`, `minBpp`) and `video/gif/*`; the server path joins `compressEngine` in M4/M5.

## 2026-09-30 · Remove Background: models, runtime and the Refine brush

**Decision:**
- **Models:** Quality mode is BiRefNet_lite fp16 (115 MB, MIT), on WebGPU with `shader-f16`. Light mode is **u2netp** (4.6 MB, Apache-2.0), on WASM.
  - u2netp wins Light mode on size: ISNet int8 would be about 44 MB, ten times more, for a mode meant for weak devices and users who decline the big download.
  - The M2 benchmark (quality vs ISNet and an int8 BiRefNet, open question 11) couldn't run here: huggingface.co is blocked in this build environment. The table waits for it; see Blocked in `STATUS.md`.
  - If quality mode fails to load or run (no model file, a WebGPU error), the tool runs Light mode and says why in the result notes. A problem with the photo itself doesn't fall back.
- **Where the files live:** `pnpm models` puts the models and ONNX Runtime Web (1.30.0) under `apps/web/public/models`, which is git-ignored and served at `MODELS_BASE_URL`. `build` and `dev` run it first; CI runs it with `--strict`.
  - Sources are in `models.json` (skipped by the host check, like `licenses.json`). SHA-256 hashes are pinned in `packages/engines/src/image/rmbg/models.ts` and checked on download and again in the browser.
  - BiRefNet's hash is printed by its first trusted download (CI) and pinned from there. Until then its download is unverified, and it's optional: without it Light mode runs.
- **Runtime:** ONNX Runtime loads at run time from `MODELS_BASE_URL`, never from the app bundle, because its WASM is 14 to 27 MB.
  - It runs in a module worker. The WASM build is plain for Light mode and asyncify (WebGPU) for Quality.
  - It runs single-threaded: tool pages aren't cross-origin isolated, so there's no SharedArrayBuffer.
  - The page downloads the model and WASM with progress ("74 / 115 MB · Step 1 of 2"), stores them in the `etb-models` cache (shared with the service worker) and hands them to the worker. No file is fetched twice.
  - The worker keeps the last mask, so changing background, edges, format or Refine strokes takes well under a second.
  - Because workers get no page CSP, production only needs the models origin in `connect-src` (already done by `postbuild`).
- **Pipeline:** the model runs at its own size (320 or 1024 px). The mask is fitted to the photo with a guided filter at up to 2048 px, then scaled to full size and composited at full resolution. The browser limit is 24 MP; above that the message suggests Resize Image first, until the server path (M5).
- **Refine brush:** "Refine by hand" opens a keep/erase brush over the result, with the original shown faintly under the cut-out.
  - Strokes are stored in image px as a JSON option, painted into the full-size mask by the worker, and cleared when a new image comes in.
  - ToolShell gains `editor.refine`, `color` and `image` option kinds, and a re-run on any setting change for `autoRun` tools.
  - Esc inside a settings sheet no longer cancels a run.
- **Copy:** hybrid tools' "Why use this" says free in the browser, with credits only for server processing.
**Why:** `tools/photo.md` → P07; `docs/13` (u2netp's weights are published under the repo's Apache-2.0, now ✅); `docs/10` (≤ 120 MB model budget, models cached by the service worker); `CLAUDE.md` rules 1, 4 and 6.
**Reverse:** swap or add models in `SEGMENT_MODELS` and `models.json`; turn threads on only if tool pages become cross-origin isolated; the server path joins `removeBackgroundEngine` in M5.

## 2026-09-30 · Script budget for working tool pages

**Decision:**
- Lighthouse now checks 6 pages: the 5 before (home, a hub, a light tool, the isolated route, and `/upscale-image` as the coming-soon page, since `/remove-background` is no longer one) plus `/remove-background`, the heaviest working tool.
- A page with a working tool gets a 180 KB script-transfer budget; every other page keeps 160 KB. The difference is ToolShell and the tool's own view (about 20 KB), which load with the page so the drop zone works at once. The engine stays out of it.
- To keep it there, what only some tools use loads when shown: the Canvas Editor, the crop fields, the timeline and the Refine brush are lazy in ToolShell, and Remove Background's engine loads when the first photo arrives (`lazyEngine`, `@etb/engines/remove-background`). Its device checks (WebGPU, cached models) run when the page is idle.
- The initial-JS budget on module scripts in the HTML (150 KB, `js-budget.ts`) is unchanged.
**Why:** `docs/10` → Budgets ("the engine is not in the initial bundle"). The 160 KB limit was set in M1, before any page ran a tool; measured on `/remove-background`: 176 KB before this, 169 KB after, against 147 KB for a hub. Made without sign-off; flagged at checkpoint 3.
**Reverse:** `TOOL_PAGES` and `TOOL_SCRIPT_MAX` in `scripts/lighthouse.ts`.
