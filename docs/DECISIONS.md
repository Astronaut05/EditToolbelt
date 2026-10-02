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
- **Deferred to M2b, with smart cut:** keeping or removing several ranges and joining them (the V01 spec's multi-range join with 10 ms crossfades). It needs a multi-range timeline and a re-encoding joiner. The page copy no longer promises it, and its FAQ says it's coming. _Done in M2b: see "Trim Video (V01): several ranges, and smart cut for VP8 and VP9" below._
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

## 2026-09-30 · "Use in another tool": the Next links carry the result

**Decision:**
- The result panel's "Next:" links (the design's wording, from the tool's related tools) take the result along when the next tool accepts its type. The file waits in memory (a module in `packages/ui`), and the next tool's shell takes it on mount as if it had been dropped. There's no upload, no storage and no URL parameter.
- It works across client-side navigations only. A full page load (a new tab, or an isolated tool such as Video Converter) starts empty. A handed-over file waits at most 30 s.
- A tool accepts a result when its registry `accepts` list has the result's MIME type (`image/*` wildcards count). Otherwise the link just navigates.
- The existing `tool_handoff` analytics event is unchanged: tool ids only, no file details.
**Why:** `docs/02` → Result panel ("hands the output to a related tool without re-upload, via an in-memory handoff"); `docs/12` → M2; `CLAUDE.md` rule 4 (nothing kept).
**Reverse:** `packages/ui/src/tool/handoff.ts` and the link's `onClick` in `ToolShell`; drop `id`/`accepts` from `ShellTool.related`.

## 2026-09-30 · Subtitle Sync (T02): times rewritten in place

**Decision:**
- Sync rewrites only the timestamps, in the file's own format. Everything else stays byte-for-byte: ASS styles and override tags, WebVTT settings, cue ids, notes and comments. That's safer than parsing and writing the file again, which drops what our cue model doesn't hold. WebVTT karaoke timestamps move with their cue, and hour-less VTT times stay hour-less.
- **Shift:** by seconds with ms precision (negative is earlier), optionally from a cue number on (cues numbered in file order, like SRT's own numbers).
- **Frame rate:** times × from ÷ to, with 23.976, 24, 25, 29.97, 30, 50, 59.94 and 60.
- **Two points:** pick two cues from a list (number, current time, the first words) and type when each should start. A line through the two fixes offset and drift. The pickers start on the first and last cue, filled in from the file (ToolShell probes can now suggest option values).
- A cue pushed before 0:00 starts at 0:00 and keeps its end time, so the rest stays in sync. The result says how many.
- Times are typed as `00:01:02.500`, `1:02.5` or seconds (`62.5`). ToolShell gains a `text` option kind for them.
- Output is UTF-8; a note says so when the file was in another encoding.
**Why:** `tools/subtitles-and-time.md` → T02 (its test: two-point sync restores offset and drift within ±10 ms, checked in unit and Playwright tests).
**Reverse:** `packages/core/src/subtitles/retime.ts` (in-place retime) and `packages/engines/src/subtitle-shift.ts`.

## 2026-09-30 · Lighthouse budgets read each metric's median of 5 runs

**Decision:** `pnpm lighthouse` runs each page 5 times (was 3), and each budget reads the median of its own values across the runs, not the values of one "median run". The saved report is still Lighthouse's median run. The budgets themselves are unchanged.
**Why:** the median run is the one closest to the median FCP and TTI, and its LCP can be any run's. Simulated LCP scales with main-thread timing, which varies from run to run: seven runs of `/remove-background` on the same build gave 1966 to 2421 ms, with the same element and the same requests. CI failed `/remove-background` at 2559 ms on a PR that doesn't touch it, and passed it on the run before. Each metric's own median is what Lighthouse's variability guide recommends. It costs about 40 s of CI time.
**Reverse:** in `scripts/lighthouse.ts`, set `RUNS = 3` and read `budget.read(medianRun(runs).lhr)`.

## 2026-09-30 · Rotate & Flip (P04) on the geometry engine

**Decision:**
- **One image** opens in the Canvas Editor on Straighten: an angle slider from −45° to 45° in 0.1° steps with a grid to line things up against, plus Rotate left, Rotate 90° (right), Flip and Flip vertical, all with undo. The preview turns live and the engine applies the same edit to the full image.
- **A free angle** is resampled bicubically on premultiplied alpha (Catmull-Rom). Corners are **Auto-crop** by default: the largest rectangle of the photo's own shape inside the rotated photo, a pixel in from each side so no anti-aliased edge shows. **Expand canvas** grows the canvas to fit instead, filled transparent, white or black. The bounding box rounds up, ignoring the last tenth of a pixel, which is only the anti-aliased edge.
- **A batch** (up to 50) has no editor. It gets one turn (90° right, 180°, 90° left) and one flip for every image, from the settings. ToolShell options can now show for one file or for several (`files: 'one' | 'many'`).
- **Quality:** 90° turns and flips move pixels without resampling. A JPG is saved again at quality 95 by default (the spec's number; 90 elsewhere). PNG stays lossless.
- **Bug fixed on the way:** a half turn (`rotateQuarter(image, 2)`) returned the original pixels, because the size helper hands back the image itself for even turns and its data won the object spread. Crop Image's "Rotate 90°" pressed twice was affected. Fixed in the same PR, with a unit test.
**Why:** `tools/photo.md` → P04 (its tests: 90° swaps the dimensions, 10° on an expanded canvas gives the expected bounding box, flips are pixel-exact; all three are unit and Playwright tests).
**Reverse:** `rotateFree`, `expandedSize`, `straightenedCrop` and `flipVertical` in `packages/engines/src/image/geometry.ts`; the Straighten mode in `CanvasEditor`.

## 2026-09-30 · Lighthouse LCP is measured with applied throttling

**Decision:** the LCP gate in `pnpm lighthouse` reads the median of 3 runs with applied throttling (the network and CPU really slowed, as DevTools does) instead of Lighthouse's simulated throttling. The other gates (performance, accessibility, best practices, CLS, TBT, script transfer) still read the median of the 5 simulated runs. The limit stays 2.5 s, stricter than a real phone on 4G would need to meet `docs/10`'s 1.8 s p75.
**Why:** simulated LCP counts, as part of the paint, everything that happened before the page painted in the real (unthrottled) run. On a local server every script arrives before the first paint, so the value swings with task timing: `/remove-background` gave 1966 to 2651 ms on one build, and CI failed it at 2553 ms (median of 5) on a PR that only adds Rotate & Flip. With applied throttling the H1 paints before the scripts arrive, as it would on a slow phone, and the same pages read 1588 to 1771 ms, run after run. TBT stays simulated because its 150 ms limit was set against simulated values. It costs about 6 minutes of CI time (18 throttled page loads).
**Reverse:** drop `applied: true` from the LCP budget in `scripts/lighthouse.ts` (and `APPLIED_RUNS` with its loop).

## 2026-09-30 · Mute Video (V07) on the timeline

**Decision:**
- Mute Video uses the `timeline` workspace, not `form` as its registry entry first said: "mute only a range" needs In and Out, and the Trim timeline already has them (frames, keys, typed times). Muting all the audio is the default, and then the timeline is only a preview.
- **All the audio:** the audio tracks are dropped and the video packets are copied as they are. A unit test checks that every video packet is byte-identical, for the spec's "video stream byte-identical". The file keeps its container (MP4, MOV, WebM, MKV).
- **The selection:** the first audio track is decoded, silenced between In and Out with 10 ms linear fades (no click), and encoded again. It uses the source codec where the browser can encode it, else the container's first encodable one, with a note. The picture is still a copy.
**Why:** `tools/video.md` → V07.
**Reverse:** `packages/engines/src/video/mute.ts`; the registry's `ui`.

## 2026-09-30 · Video Info (V08) on Mediabunny, not mediainfo.js

**Decision:**
- Video Info reads files with Mediabunny, already loaded by the video tools and approved, instead of adding mediainfo.js (a 2.5 MB WASM whose bundled libraries would each need a licence check). It reads the headers and the packet table, never the picture, so a 2 GB file is quick.
- **What it shows:** container, size, duration, overall bitrate, title, date and comment; video codec with profile and level (read from the codec string), bit depth, resolution, coded size, display and pixel aspect, frame rate and whether it's constant or variable, frame count, bitrate, color primaries, transfer, matrix, range, HDR and rotation; each audio track's codec, channels, sample rate, bitrate and language.
- **Variable frame rate** is measured, not read from a header: Mediabunny fits every frame's time to a frame-rate lattice, and no fit means VFR.
- **Verdicts first**, each with what to do: VFR (may drift in Premiere), HDR (washed out on an SDR timeline), rotation metadata, or "ready to edit". Then what doesn't block an edit: no audio, several audio tracks, a codec this browser can't play.
- The analyzer view shows six headline facts, then the full report. The report downloads as text or JSON.
- **Fixtures** for the spec's tests are remuxed from the existing clip by `packages/engines/scripts/video-fixtures.ts`, without re-encoding: a VFR clip (frames on an irregular clock) and an HLG clip (BT.2020 + HLG tags).
**Why:** `tools/video.md` → V08; `docs/13` (no new dependency); `CLAUDE.md` rule 1.
**Reverse:** swap `videoReport` for mediainfo.js if editors need more encoder settings; the analyzer UI stays.

## 2026-09-30 · GIF to MP4 (V05): our own GIF reader, the GIF's own clock

**Decision:**
- GIFs are read by our own decoder (`packages/engines/src/video/gif/decode.ts`: LZW, disposal, transparency, interlacing), not the browser's `ImageDecoder`: it isn't in every browser we support, it runs in Node for tests, and it composes frames exactly as browsers show them. It decodes one frame at a time, so a long GIF never sits in memory as pictures.
- **Timing:** every frame keeps its own delay as a video frame of that length (variable frame rate), so the video plays exactly like the GIF. Delays of 0 or 10 ms play at 100 ms, as browsers play them.
- **Transparency** is filled with a background colour (white by default), since MP4 has no alpha. Odd sizes get one row or column of background, as H.264 needs even sizes.
- **Plays:** 1 to 10 times in the video. H.264 in MP4 where the browser encodes it, else VP9 in WebM, and the result says so.
- `/convert/gif-to-mp4` is held: the tool page already is that conversion.
- The fixture `fixtures/video/anim-delays.gif` is written byte by byte by `packages/engines/scripts/gif-fixtures.ts`, independent of our GIF encoder.
**Why:** `tools/video.md` → V05 (its test: variable GIF delays mapped correctly, checked frame by frame in Playwright from the output's packet times).
**Reverse:** `packages/engines/src/video/gif-to-video.ts`; swap the reader for `ImageDecoder` once every supported browser has it.

## 2026-09-30 · Video Converter (V03) in the browser, AVI and ProRes held for the server

**Decision:**
- The browser path runs on the same WebCodecs engine as the other video tools (Mediabunny), not ffmpeg.wasm: it reads MP4, MOV, WebM and MKV. `video-ffmpeg-wasm` is dropped from the tool's engines; the server path (AVI, ProRes, DNxHD, very large files) comes with the M3 job pipeline, and the page says so when it meets one. `/convert/avi-to-mp4` is held until then.
- **Remux when the tracks fit** the target the way that container is used, not merely what it can hold: MP4 takes H.264, HEVC and AV1 with AAC, MP3 or AC-3; MOV adds ProRes and PCM; WebM takes VP8, VP9 and AV1 with Opus or Vorbis; MKV takes almost anything. So MKV (VP9) → MP4 re-encodes to H.264, and a track that fits is copied even when the other is re-encoded.
- **Re-encode** at high quality, in H.264 + AAC for MP4 and MOV, VP9 + Opus for WebM; "Re-encode" with a codec choice forces it. Where the browser can't encode H.264 or AAC, the file becomes WebM and the result says so, as in the other video tools.
- **No cross-origin isolation:** COOP/COEP was on this route for multi-threaded ffmpeg.wasm (docs/01 → Cross-origin isolation). WebCodecs needs no SharedArrayBuffer, and docs/01 puts the headers only on routes that need them, so the registry flag is dropped and no route is isolated today. It mattered for speed as well: with the headers, Lighthouse's simulated LCP on the page was 2566 ms, without them 2116 ms, with the same scripts. The mechanism stays (the registry flag, the headers, full page loads into isolated routes), unit-tested, for a later ffmpeg.wasm fallback. Links into Video Converter are soft navigations now, so the "Use in another tool" handoff reaches it too.
- Fixtures: `clip-h264-aac.mov` and `clip-vp9-opus.mkv`, 4 s remuxes of the existing clips by `packages/engines/scripts/converter-fixtures.ts`.
- **Page weight:** `/video-converter` is a working tool page now, so Lighthouse holds it to the tool script budget (180 KB, see "Script budget for working tool pages"). Its engine loads on the first run and the shared video probe loads Mediabunny with the first file, so neither is in the page's initial scripts: 170 KB measured, down from 335 KB with Mediabunny loaded up front.
**Why:** `tools/video.md` → V03 (its tests: MOV (H.264) → MP4 is a remux with identical frame hashes, in unit and Playwright tests; MKV (VP9) → MP4 re-encodes to H.264, in Playwright where the browser encodes H.264); `CLAUDE.md` rule 1.
**Reverse:** `packages/engines/src/video/convert-video.ts` (`FITS`, `ENCODE`, `planConversion`); `TOOL_PAGES` in `scripts/lighthouse.ts`.

## 2026-09-30 · Audio: our own MP3 and FLAC encoders everywhere, one gapless pipeline

**Decision:**
- MP3 is always encoded with LAME and FLAC with libFLAC (our lazy-loaded WASM builds), even where the browser has its own encoder.
- Every audio-only re-encode (Extract Audio, Audio Converter, Trim Audio) goes through one pipeline, `encodeAudio`: decode the range, keep the blocks on one unbroken timeline from 0, encode, copy the tags. A block that overlaps the one before loses the overlap; a gap, or a track that ends early, becomes silence, so the file is as long as the part asked for. A frame or two either way is timestamp rounding and left alone.
**Why:** WebKit's MP3 extract came out 192 ms short. A diagnostic run on CI showed WebKit decodes the whole track (a WAV extract is 30.001 s), but its own GStreamer MP3 encoder, which we used wherever the browser had one, ignores the bitrate (171 KB for 30 s at 192 kbps) and drops the last 8 frames. With our encoders every browser writes the same file. The pipeline keeps the length promise (V06: within 10 ms) whatever a decoder does with damaged frames.
**Reverse:** `ensureEncoder` in `packages/engines/src/video/extract-audio.ts`; `packages/engines/src/video/encode-audio.ts`.

## 2026-09-30 · Audio Converter (A01) on Mediabunny

**Decision:**
- Audio Converter uses the engine the video tools already load (Mediabunny with WebCodecs, plus the LAME and libFLAC WASM encoders loaded only when MP3 or FLAC is picked), not a separate `audio-dsp` engine. The registry and `tools/README.md` say `video-webcodecs`.
- **MP3 is constant bitrate** (128 to 320 kbps). VBR is not offered yet: the encoder is driven by a target bitrate. The FAQ says so.
- **Bit depth** (16 or 24-bit) is offered for WAV only.
- **Sample rate** 44.1, 48 or 96 kHz, and **channels** mono or stereo; both default to Keep.
- A file already in the target codec with nothing to change is copied, not re-encoded. Tags are copied either way.
- Six pair pages (`/convert/wav-to-mp3`, `mp3-to-wav`, `m4a-to-mp3`, `flac-to-mp3`, `ogg-to-mp3`, `mp3-to-ogg`), each written for its pair.
**Why:** `tools/audio.md` → A01; `CLAUDE.md` rule 1 (browser first) and `docs/13` (no new dependency).
**Reverse:** swap the engine in `packages/engines/src/audio/convert.ts`; add VBR if a LAME build with `-V` lands.

## 2026-09-30 · Trim Audio (A02): one range, keep or remove

_Ranges and the join: superseded by "Several ranges on the timeline, joined with a 10 ms crossfade" below._

**Decision:**
- One range on the timeline, kept or removed. **Multiple ranges are left for later**: the timeline shell has one In and one Out, and a multi-range editor belongs with V01's smart cut. The registry's promises say one range.
- **Removing** joins the two sides with a 5 ms fade on each side of the join, so it doesn't click. Fade in and out are 0.5 to 3 s, or none.
- **WAV and FLAC** are cut to the sample and stay lossless. **MP3, AAC and Opus** kept without fades are copied frame by frame (the cut lands on the nearest frame, about 26 ms for MP3); with fades, or when removing a range, they are re-encoded in their own codec at their own bitrate.
- The timeline shows the **real waveform** (peaks read from the file) and steps by the millisecond; an audio player under it follows the playhead.
**Why:** `tools/audio.md` → A02 (its test: 5.000 to 15.000 s of a WAV gives 10.000 s, checked to the sample in unit and Playwright tests).
**Reverse:** `packages/engines/src/audio/trim.ts`; `peaks` on `Timeline` falls back to the stand-in bars when a page passes none.

## 2026-09-30 · BPM & Key Finder (A03): in-house DSP, synthetic test set

**Decision:**
- **Tempo:** an onset-strength envelope (spectral flux of log magnitudes, 1024-sample frames, 11.6 ms hop at 22.05 kHz, local mean removed, smoothed by σ = 17 ms), autocorrelated. Each BPM from 50 to 220 is scored by a comb over its beat period and multiples (bars), with a broad preference around 120 BPM unless a range is picked (60–90, 90–140, 140–200). Half and double tempo are listed as alternatives. The tempo is then refined between frames: a parabola through the autocorrelation peaks at 1 to 4 beats, since a linear interpolant always peaks on a whole frame (a 120 BPM track read as 120.2).
- **Beats:** the phase of that period with the most onset strength, each beat taking the strongest onset within 23 ms, then the phase within those 23 ms that lands on the onsets themselves. Exported as CSV (beat, seconds) or plain text; steady tempo only for now.
- **Key:** a chromagram (8192-point frames, 55 Hz to 2 kHz, energy near each semitone folded into 12 pitch classes) correlated with the Krumhansl-Kessler major and minor profiles; the name uses sharps or flats as musicians write the key, with its Camelot code.
- **Tap tempo and metronome** are a shared ToolShell section (`preset.tempo`), usable with no file: the pad (or the T key) reads the median of the last 8 gaps and resets after 2.5 s; the metronome schedules its clicks on the Web Audio clock (2/4 to 6/8, first-beat accent, three sounds).
- **Whole track only:** analysing a selection is left for later; the analyzer view has no timeline.
- **Tests:** the spec asks for 30+ labelled, license-free tracks. There's no such set here, so the labelled set is generated in the test: 30 drum loops from 72 to 174 BPM (all 30 within ±1 BPM or exactly half or double, against the ≥ 90 % bar) and 30 chord progressions in all 24 keys plus 6 pop loops (all 30 correct, against the ≥ 75 % bar). Real recordings are harder; the stress test should add a handful of license-free songs.
- An analyser tool that reads the file first (a probe) now also runs as the file arrives, as `autoRun` asks.
**Why:** `tools/audio.md` → A03 (in-house DSP, no AGPL libraries); `CLAUDE.md` rules 1 and 6.
**Reverse:** `packages/core/src/audio/analysis.ts` (`detectTempo`, `detectKey`); swap in a trained model later if accuracy on real music falls short.

## 2026-09-30 · Color Palette (C01) and Color Picker (C02) in the shell

**Decision:**
- **Palette:** the image is scaled to 256 px on its long side, its pixels binned (5 bits a channel) and grouped by weighted k-means in Oklab, seeded k-means++ with a fixed seed so the same image always gives the same palette. Colours closer than ΔE 2 are merged, so an image with 4 colours gives 4 even when 6 are asked for. Vibrant keeps pixels with Oklch chroma ≥ 0.1, Muted < 0.08; each falls back to every pixel if under 2 % of the image qualifies. Near-white and near-black are left out by default. The maths is in `packages/core` (`extractPalette`, shared with the panel).
- **Palette result:** a new ToolShell result view (`Swatches`): a strip with each colour as wide as its share, then a card a colour with its % written out and HEX, RGB and HSL to copy. The download is CSS variables (default), JSON, ASE (Adobe Swatch Exchange 1.0, RGB) or a PNG palette card (a band a colour, its HEX under it). It runs as the image arrives, and again on any change.
- **Picker:** a new ToolShell workspace (`preset.picker`): the image, a loupe (4×, 8× or 16×, the sample outlined), a live readout and the list of picks (up to 24, newest first). Keyboard: Tab to the image, arrows move one pixel, Shift ten, Enter picks. Pixels are read with no colour-space conversion, so 1 px is the file's exact value; 3 × 3 and 5 × 5 are averaged in linear light. Picks are kept in an option, so the download (CSS, JSON or ASE of the picks, oldest first) stays current.
- The picker loads the image through an `<img>` element: the page's CSP (`connect-src 'self'`) doesn't let `fetch` read `blob:` URLs, and it shouldn't.
**Why:** `tools/color.md` → C01 (4 flat colours → exactly those 4 within ΔE 2) and C02 (pixel-exact read), both checked in unit and Playwright tests; `CLAUDE.md` rule 2 (one shell).
**Reverse:** `packages/core/src/color/palette.ts`, `packages/engines/src/image/{palette,pick}.ts`, `packages/ui/src/tool/{Swatches,ColorPicker}.tsx`.

## 2026-09-30 · Media engines load on first use

**Decision:**
- Every video and audio tool now loads its engine, and Mediabunny with it, on the first run, as Remove Background and Video Converter already did. The file probes and the waveform load it with the first file. Pages get the engine through `mediaEngine()` (`apps/web/src/tools/media-engine.ts`), which imports the new `@etb/engines/media-engines` entry.
- What a page needs before that (whether the browser can run the engine, a rough time, the limits, the GIF size estimate) moved to `packages/engines/src/media-meta.ts`, which has no Mediabunny behind it. The engines spread the same `MEDIA_META` entries in, so the page and the engine answer the same.
- Measured on the production build: the 11 media tool pages load 167 to 172 KB of script, down from 325 to 335 KB.
**Why:** `docs/10` → Budgets ("the engine is not in the initial bundle"). Only `/video-converter` is in the Lighthouse set, so nothing failed, but every other media page loaded 160 KB of Mediabunny it might never use.
**Reverse:** import the engines from `@etb/engines` again in `apps/web/src/tools/*.tsx`.

## 2026-09-30 · Tools go straight to `live` until there is an admin and real traffic

**Decision:** the 26 working tools are `live` in the registry, not `beta` first. `docs/02` (step 6 of the tool checklist) asks for `beta` and a flip to `live` "after a day without errors in admin", but there is no admin (M3) and no traffic before Go public, so there are no errors to watch. Every tool instead passes its unit and Playwright tests on the production build in four browsers before its PR merges.
**Why:** a `beta` tag on every tool of a site nobody can reach yet would tell nobody anything, and the flip would be a no-op later. The rule starts to mean something with M3's admin and the Go public step.
**Reverse:** set `status: 'beta'` in the tool's registry entry (or, from M3, override it in admin).

## 2026-09-30 · Several ranges on the timeline, joined with a 10 ms crossfade (A02, then V01)

**Decision:**
- **The timeline holds several ranges** when a page asks for them (`preset.ranges`). The handles, In, Out and the I and O keys edit the selected range; ranges never overlap (each stays between its neighbours); a row of buttons under the timeline selects one ("Range 2: 00:16.000 to 00:17.000"), adds one and removes the selected one. **Add range** puts a new range at the playhead when it is in a free stretch, else after the last range, 1/20 of the clip long (at least 1 s) where there's room. The engine gets every range as `ranges`, plus the selected one as `start`/`end`, so a single-range engine still works. At most 50 ranges.
- **Keep or remove** applies to all of them: keep joins the ranges in time order; remove joins what's left. Ranges that touch or overlap merge.
- **Joins crossfade over 10 ms**, centred on the join: the last 5 ms of one part fade out over the first 5 ms of the next fading in, using the audio just past each cut. Linear gains that add up to 1, so a steady sound stays level through the join. The result is exactly as long as the kept parts, to the sample (a dip or a gap would drift video out of sync in V01). A part shorter than 10 ms gets a shorter crossfade. This replaces A02's 5 ms fade to silence on each side of the join, which could still be heard as a dip.
- **A02:** one part kept without fades is still copied frame by frame for MP3, AAC and Opus. Anything else is decoded once, only the stretches the parts need, joined by the splicer in `packages/core` (pure, unit-tested: exact length, no click, level through the join) and encoded once.
- The playhead now follows In and Out when they are edited, so the frame or sample shown is the one the cut is at.
**Why:** `tools/audio.md` → A02 ("multiple ranges") and `tools/video.md` → V01 ("keep/remove multiple ranges and join them", "crossfade 10 ms at joins"), deferred from the M2 launch set.
**Reverse:** drop `ranges: true` from a page's preset and it is back to one range; the crossfade length is `JOIN_CROSSFADE` in `packages/engines/src/audio/trim.ts`; the splicer is `packages/core/src/media/splice.ts`.

## 2026-09-30 · Trim Video (V01): several ranges, and smart cut for VP8 and VP9

**Decision:**
- **Several ranges, kept or removed**, on the timeline A02 uses. One kept part takes the paths V01 already had. Several go through a new join writer (`packages/engines/src/video/join.ts`): each part's timestamps move so the parts play back to back, in one output track.
- **Fast, several parts:** each part's packets are copied from the keyframe at or before its In point, as a single Fast trim is. The result says how early the earliest part starts. At the Out point it copies every frame shown before Out, plus any frame decoded before one of those (the frames B-frames refer to, which can add a frame or two).
- **Precise = smart cut for VP8 and VP9 in WebM or Matroska** (profile 0, 8-bit, unrotated, with an encoder for the codec). From each In point to the next keyframe, the frames are decoded and re-encoded in the same codec, at 1.5 × the source's average bitrate, on their own encoder, so they start with a keyframe. From that keyframe to Out, the source packets are copied byte for byte (checked in Playwright). A cut on a keyframe re-encodes nothing.
  - The track's decoder config is the source's, even when re-encoded frames come first: Mediabunny's WebM writer rewrites every VP9 keyframe's colour-space bits to match the first config, and copied keyframes must stay as they were.
  - Parts end after their last kept frame's timestamp, not after its duration: WebM rounds times to the millisecond, so a frame's end can land just past the next keyframe.
- **Precise for everything else (H.264, HEVC, AV1): a full re-encode**, as before, now of all the parts in one pass. We didn't smart-cut H.264: an MP4 track holds one set of parameter sets (SPS and PPS) in its header, and frames from our encoder would need their own. Mixing them breaks decoding in some players. Revisit if Mediabunny writes parameter sets in band.
- **The audio in a join** goes through A02's splicer: a 10 ms crossfade centred on each join, re-encoded as AAC for MP4 and MOV, Opus for WebM and MKV, when the browser can decode the source and encode the target. Otherwise each part's audio packets are copied back to back and the result says a join may click. Audio that can do neither is left out, and the result says so. In Fast mode this means the video is copied and the audio re-encoded, because copied audio can't crossfade.
- **Remove** keeps what's around the ranges; a sliver under 0.04 s left beside a removed range (the container's rounding past the last frame) isn't a part.
**Why:** `tools/video.md` → V01 ("keep/remove multiple ranges and join them", "smart cut comes in M2b", "multi-range join has no audio clicks (crossfade 10 ms at joins)").
**Reverse:** `smartCutFits` in `packages/engines/src/video/trim.ts` decides smart cut (return false for a full re-encode); `joinParts` in `join.ts` does the join; drop `ranges: true` from `apps/web/src/tools/trim-video.tsx` for one range.

## 2026-09-30 · The database (M3): schema, migrations and the ledger's guarantees

**Decision:**
- **Every table in `04`**, in `packages/db` (Drizzle 0.45, node-postgres), with UUIDv7 ids from Postgres 18's `uuidv7()` and `timestamptz` times. Migrations are SQL files in `packages/db/migrations`: drizzle-kit writes them from the schema, and hand-written ones add what it can't express (the `citext` extension, triggers). `pnpm db:migrate` applies them. On the local stack a `migrate` service runs them before the worker starts.
- **`users` follows Better Auth's field set**, so its Drizzle adapter reads and writes it directly:
  - `email_verified` is a boolean, not `email_verified_at`.
  - `display_name` is Better Auth's `name`.
  - It has Better Auth's `image` column, which we never fill: no avatar URLs are kept.
  - `two_factor_enabled` is the TOTP plugin's field.
  - One addition: `disabled_at`, for the admin "disable account" action (`07`), which blocks sign-in.
- **Sessions have Better Auth's `ip_address` and `user_agent` columns, but a check constraint keeps both null.** `08` says the app stores no IPs, so the database refuses them. The auth config (next PR) turns IP tracking off and strips the user agent.
- **The ledger enforces more than "no UPDATE or DELETE":**
  - The trigger also refuses TRUNCATE.
  - Check constraints keep each kind's sign: `capture` 0; `reserve`, `admin_debit` and `refund_purchase` negative; the rest positive.
  - Admin kinds need an admin and a non-empty reason.
  - `reserve`, `capture` and `release` need a job id.
  - Neither `balance_after` nor `users.credit_balance` can go below 0.
  - `applyCredit` locks the user row (`SELECT … FOR UPDATE`) and is the only writer. 16 concurrent reserves on a 10-credit balance give exactly 10 successes in the tests.
  - `ledgerMismatches()` is the nightly invariant check (wired to alerts in M3's last PR).
- **`admin_audit_log` is append-only too**, with the same trigger: an audit log an admin could edit proves nothing.
- `webhook_events` is unique on (provider, event id) rather than event id alone: the same once Paddle is the only provider, and correct if a second one comes.
- **Two operational tables beyond `04`:** `service_heartbeats` (the last sign of life of each web, worker and GPU backend instance, for the dashboard and the "heartbeat missing" alert) and `system_checks` (the latest result of each scheduled check, for `/admin/system`).
- **Integration tests run against a real Postgres 18** and only when `TEST_DATABASE_URL` is set, never `DATABASE_URL`, because ledger rows can't be deleted. CI gives the required JS job a Postgres 18 service, so they gate every PR. They cover UUIDv7 ids, the ledger and its triggers, the sign and reason checks, concurrent reserves, the no-IP sessions, case-insensitive unique emails with tombstones allowed, and the append-only audit log. CI also fails if the schema changed without a migration.
**Why:** `docs/04-data-model.md`, `docs/08` (minimal data), `CLAUDE.md` rule 5 (append-only ledger); M3 in `docs/12`.
**Reverse:** a new migration changes any of it. The triggers and constraints can be dropped, but the ledger rule says they shouldn't.

## 2026-09-30 · The server build, and accounts (M3)

**Decision:**
- **One app, two builds.** `ETB_TARGET` picks the build:
  - The static export (default) stays exactly the public site `pnpm preview` serves and Cloudflare Pages will serve after Go public. No accounts, no API. That matches `12` ("any public site stays static until M5").
  - The server build (`ETB_TARGET=server`, into `.next-server`) is the same pages plus accounts, and the admin and API next. The local stack runs it, and it becomes production in M5.
  - Route files named `*.server.tsx`/`.ts` exist only in the server build, and `*.static.tsx`/`.ts` only in the static one: the same `pageExtensions` switch the workshop uses. `/sign-in` has one of each: the static one says accounts come later, the server one signs you in.
  - The server build skips Next's own type pass, which would read the static build's generated route types. `pnpm typecheck` still checks every file.
- **Better Auth 1.7 with email magic links, and Google when both Google variables are set.** No passwords.
  - Links last 15 minutes, work once and are stored hashed. Sessions last 30 days, refreshed daily. The cookie is `etb.session_token`: httpOnly, SameSite=Lax, Secure on https.
  - The magic-link endpoint gets no IP address (tracking is off), so it's limited per address: 3 links in 15 minutes, keyed by a hash of the email.
  - A disabled account gets no link, and a session hook refuses it too (for Google).
  - Signing in during the 30-day grace restores a deleted account.
  - Better Auth's anonymous telemetry is switched off (`CLAUDE.md` rule 7).
  - Sessions keep no IP address or user agent (the database refuses them). Google sign-in stores no tokens and no avatar URL: sign-in is all it's for.
- **Sign-in email:** SMTP through Nodemailer (MIT-0). On the local stack, Mailpit catches everything in a web inbox at port 8025, so nothing leaves the PC. Tests write each email as a JSON file instead (`MAIL_OUTBOX_DIR`, refused outside local and test). The production email provider is chosen at Go public; it only needs an SMTP URL.
- **`/account`:**
  - Profile: an optional name, and the product-news opt-in.
  - Credits: the balance, read-only until M5.
  - Sign out, and sign out everywhere.
  - "Download my data": JSON with the profile, how you sign in, purchases, the ledger, 90 days of job metadata and API keys by name. No tokens, no secrets.
  - Delete: type `delete` to confirm. It signs you out everywhere, revokes API keys, and cancels queued jobs with their credits released through the ledger. The 30-day scrub into a tombstone runs with M3's scheduled jobs.
  - Forms are server actions: Next checks their Origin (CSRF), and inputs go through Zod.
- **CSP on the server build:**
  - Pages rendered per request (`/account`, `/sign-in`, and `/admin` next) get a fresh nonce with `'strict-dynamic'`, plus the root layout's theme script by hash, and `Cache-Control: private, no-store`.
  - Prerendered pages use the `'unsafe-inline'` fallback `11` allows, until M5 decides how the server build serves public pages.
  - A proxy (Next's middleware, Edge runtime) also sets the same security headers `_headers` gives the static site.
- **The server build has no service worker.** Its precache list comes from the static export, and signed-in pages must never come from a cache. It serves its own `/favicon.ico`.
- **Health:** `/healthz` (up) and `/readyz` (database reachable, registry loaded; 503 problem+json otherwise).
- **Tests:** `pnpm --filter @etb/web e2e:server` migrates `TEST_DATABASE_URL`, builds the server target and runs Playwright on desktop Chromium, Firefox and WebKit. It covers sign-in with a one-use link, no IP or user agent stored, nonce CSP with zero violations, profile save, data export, delete and restore, disabled accounts, and the health checks. CI runs it in the required JS job against the Postgres service. The stack smoke test checks `/readyz` and the sign-in page.
**Why:** `docs/12` → M3 (sign in, export and delete an account on the local stack), `docs/11` → Auth, `docs/04` → Account deletion, Data export, `docs/08` → minimal data and self-serve rights.
**Reverse:** unset `ETB_TARGET` and the site is the static export again. `apps/web/src/server/auth.ts` holds every auth choice.

## 2026-09-30 · Tool status from the database, and the admin (M3)

**Decision:**
- **The registry takes runtime overrides** (`packages/registry/src/flags.ts`): status, maintenance message, surfaces, server path, cost and limits.
  - `isAvailable`, `isListed`, `needsWasm`, the hubs, the search index, the sitemap and `GET /api/v1/tools` all read the effective values.
  - The static export sets none, so it's unchanged.
  - The server build loads every `tool_flags` row at most 30 s old before rendering anything that shows status. A tool with no page in `src/tools` can't be switched to live or beta: that override is ignored, and the admin doesn't offer it.
- **Public pages in the server build revalidate every 30 s** (ISR). An admin save also clears the cache in its own process and calls `revalidatePath`, so the change shows at once there and within 30 s anywhere else.
  - The tool and pair routes are split into `page.static.tsx` (`dynamicParams = false`, as before) and `page.server.tsx` (`revalidate = 30`), sharing one `view.tsx`.
  - We found why in testing: with `dynamicParams = false`, a path that once rendered as not-found stays 404 even after the tool is switched back on.
  - The server build generates a page for every tool and pair, so a tool disabled in code can be switched on from the admin.
- **The admin** (`/admin`, server build only) has Dashboard, Tools, Users, Audit log and System (`07`).
  - Jobs, Payments and Costs come with M4 and M5; until then the dashboard says so, and browser tools point at the analytics collector.
  - Everything is server-rendered, with a per-request nonce CSP, no-store, and no client JavaScript of its own.
  - Every write re-checks the admin (a layout doesn't guard server actions), validates with Zod, needs a reason, and writes the audit row in the same transaction.
  - Actions: tool status, maintenance message, surfaces, server path, cost and limits overrides (JSON checked against the registry's own schemas); grant or debit credits through `applyCredit`; disable or enable an account (disabling signs it out everywhere); revoke API keys; delete an account; download an account's data (audited); run the ledger check.
- **Admins pass TOTP in each browser every 12 hours.** Better Auth's two-factor plugin holds the secret (encrypted) and the backup codes, but its challenge only runs on password sign-ins, and we have none.
  - So `/admin` asks for a code itself, and a correct one sets a signed, 12-hour, `/admin`-only, SameSite=Strict cookie bound to the user. A signed cookie survives the session rotation that confirming TOTP causes; a flag on the session wouldn't.
  - Five wrong codes in 15 minutes lock the form. Backup codes work too.
  - Anyone who isn't an admin gets a 404 on every admin path.
  - An optional `ADMIN_IP_ALLOWLIST` makes the proxy answer 404 to other IPs. It compares Cloudflare's `CF-Connecting-IP` (or `X-Forwarded-For`) and never stores it.
- **The first admin:** sign in once, then `pnpm admin:promote <email>` (on the stack: `docker compose exec web pnpm admin:promote <email>`), which writes the audit log too. There's no way to become an admin from the web.
**Why:** `docs/12` → M3 ("flip any tool's status from admin and see it change within 30 s"; "registry resolution from DB flags, 30 s cache"; "TOTP for admins"), `docs/07` → Admin panel, `docs/11` → Admin, `docs/02` (DB flag, then code default).
**Reverse:** `apps/web/src/server/flags.ts` (the cache) and `src/server/admin.ts` (the gate); drop `revalidate` from the `page.server.tsx` files to render per request instead.


## 2026-09-30 · Alerts, the daily digest and the scheduled jobs (M3)

**Decision:**
- **The worker runs a scheduler** (`apps/worker/src/etb_worker/scheduler.py`) every 30 s, beside M4's job queue later.
  - Each worker writes its heartbeat to `service_heartbeats` and removes it on a clean stop, so only a crash reads as missing.
  - One worker at a time (a Postgres advisory lock) then checks the alert rules and runs whatever daily job is due.
- **Daily jobs keep their last run in `system_checks`**, so a restart doesn't repeat one and a worker that was down catches up when it starts.
  - At 03:00 Tashkent: the ledger check, the account scrub and the retention purges.
  - At 09:00 Tashkent: the digest.
  - A job that fails alerts and is retried in 10 minutes.
  - `python -m etb_worker --task <name>` runs one now (`docker compose exec worker …` on the stack).
- **Tashkent is a fixed UTC+5.** It has had no daylight saving since 1992, so the slim image needs no time-zone database.
- **The account scrub follows `04` → Account deletion.** 30 days after deletion:
  - Email, display name, locale and image are nulled.
  - Sessions, sign-in methods, TOTP and API keys are deleted.
  - The row's id stays, so the ledger is never updated.
- **The retention purges:**
  - Welcome-grant claims after 12 months (`08`).
  - Expired sign-in links a day after they expire, and expired sessions.
  - Heartbeats not seen for a day.
  - Alerts after 90 days.
- **Alert rules in M3** (`07` → Alerts, each with a 30-minute cool-down per rule and subject):
  - A heartbeat missing for 2 minutes.
  - Database connections over 80 % of max.
  - The worker's disk over 80 %.
  - A tool's server failure rate over 10 % across 30 minutes with at least 10 jobs.
  - Queue wait p95 over 2 minutes across 10 minutes. It counts jobs still waiting, so a stuck queue alerts too.
  - A ledger mismatch alerts at once, with no cool-down.
- **Rules that watch things that don't exist yet arrive with them:**
  - The retention sweeper, stale objects, multipart uploads and lifecycle rules in M4.
  - Webhook errors in M5.
  - Tool margin, in the digest, once jobs have costs (M4).
- **Delivery:** Telegram first, email as backup.
  - Email is used only when Telegram isn't set up or fails. With neither set up, alerts are logged and listed in Admin → System.
  - Both use the standard library (urllib, smtplib), so there are no new packages.
  - Messages hold rule names, tool ids, service names and numbers, never personal data.
  - The bot token sits in the request path, so no URL is ever logged.
- **A new `alerts` table** records every alert (the cool-down reads it, Admin → System lists the last 20).
- **The host check allows one third-party host, `api.telegram.org`**, in a named list (`THIRD_PARTY_APIS` in `scripts/check-hosts.ts`). Its provider fixes it, so moving our hosts never changes it. `TELEGRAM_API_URL` overrides it for tests.
- **On the stack,** alert and digest emails land in Mailpit. Telegram works when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are in a git-ignored `.env`.

**Why:** `docs/12` → M3 ("Telegram alerts and daily digest wiring"), `docs/07` → Alerts, `docs/04` → Account deletion, `docs/05` (the nightly ledger invariant), `docs/08` (retention periods).
**Reverse:** stop the loop in `main.py` (the worker goes back to idling). Rules and jobs are one entry each in `alerts.DATABASE_RULES` and `scheduler.DAILY`.

## 2026-09-30 · drizzle-kit's esbuild moved to the patched line

**Decision:** a pnpm override (`pnpm-workspace.yaml`) moves the esbuild that `@esbuild-kit/core-utils` (under drizzle-kit, dev only) pins from 0.18.20 to 0.25.12. That clears Dependabot's moderate alert for GHSA-67mh-4wv8-2f99 on `main`. The flaw is in esbuild's dev server, which drizzle-kit never starts, so nothing was exposed; the override just keeps the alert list empty. 0.25.12 was already in the lockfile (drizzle-kit uses it directly), so nothing new is downloaded, and `pnpm db:generate` works the same.
**Why:** `docs/11` (keep dependency alerts at zero); `pnpm audit` is clean after it.
**Reverse:** delete the `overrides` entry once drizzle-kit drops `@esbuild-kit`.

## 2026-09-30 · Uploads straight to storage (M4)

**Decision:**
- **`POST /api/v1/uploads`, `/uploads/:id/parts`, `/uploads/:id/complete` and `DELETE /uploads/:id`** (`06`), in the server build.
  - Signed-in callers only; API keys come with the panel (M7).
  - A write carrying the session cookie must come from our own origin, else 403. The cookie is SameSite=Lax already; this refuses anything else that carries it.
  - The tool must be available and have a server path: a `server-cpu`/`server-gpu` tool, or a `hybrid` one whose server path an admin switched on (`hasServerPath()` in the registry).
  - Size, the caller's tier (paid once a purchase has gone through) and type are checked against the registry. Answers are problem+json with `06`'s stable codes (`FILE_TOO_LARGE` with `max_bytes`, `UNSUPPORTED_FORMAT`, `TOOL_UNAVAILABLE`, `UPLOAD_INCOMPLETE` with the missing parts).
  - At most 5 unfinished uploads per account, and 30 new uploads a minute, with `RateLimit-*` headers.
- **Parts:** 8 MiB each (whole MiB above that when 10,000 parts aren't enough), one size per upload as R2 requires (`planParts()` in `packages/core/src/upload.ts`, shared with the browser uploader).
  - The first 20 part URLs come with the upload; more come 50 at a time.
  - Each part URL is presigned for 15 minutes **with the part's exact length signed**, so storage refuses anything else. A test checks it.
- **Keys are `in/<uuid>`**, never derived from the user or the file. Complete checks the stored size against the claimed one and deletes a mismatch. It then sets the upload to expire in an hour unless a job uses it, and `NOTIFY`s the worker to probe it.
- **Signing with aws4fetch** (MIT, no dependencies), not the AWS SDK: six plain S3 calls (create, complete, abort multipart, head, delete, presign) don't need a large, daily-released dependency tree.
- **Two storage addresses:** the server calls storage at `S3_ENDPOINT`, and presigns URLs for `S3_PUBLIC_ENDPOINT` (the stack: `storage:7070` inside, `localhost:7070` for your browser).
  - The storage origin joins the server build's CSP `connect-src`.
  - `/readyz` now checks storage too.
- **The stack's storage allows any origin (CORS `*`).** The bucket is private and a presigned URL is the only way in, so CORS guards nothing more. It lets the dev server (:3000) and the tests (:4175) share one storage. In production R2's CORS will list our origin.
- **Compress Video's server path gets limits:** free 2 GB and 60 min (the same as its browser limit), paid 10 GB and 4 h. It stays off until an admin switches it on.
- **CI's JS job starts the same gateway image for the server-build tests.**

**Why:** `docs/12` → M4 ("Upload API (multipart presign)"), `docs/01` → Upload, `docs/06` → Endpoints, `docs/11` → Storage.
**Reverse:** the routes are `apps/web/src/app/api/v1/uploads/**`; the logic is `apps/web/src/server/uploads.ts` and `storage.ts`.

## 2026-09-30 · The worker's job queue, probe, sandbox and retention sweeper (M4)

**Decision:**
- **The worker runs job slots beside its scheduler** (`WORKER_SLOTS`, default 1): threads, each probing new uploads and running one job at a time. The work happens in ffmpeg processes, so threads are enough. A listener wakes idle slots on `NOTIFY etb_jobs` / `etb_uploads`; they also poll every 2 s (`01`).
- **The queue is the `jobs` table** (`apps/worker/src/etb_worker/jobqueue.py`):
  - Claims take the highest-priority, oldest queued job whose tool is under its cap, `FOR UPDATE SKIP LOCKED`.
  - Running jobs heartbeat every 5 s; the heartbeat also notices a cancel.
  - The reaper sends a job whose worker went quiet for 60 s back to the queue, at most twice. The third time it fails with `WORKER_LOST`.
  - A job queued for 15 min expires.
  - Every status change and its ledger row are one transaction: release on failure or expiry, a 0-credit capture on success. `ledger.py` mirrors `applyCredit`, and the nightly ledger check covers both.
- **Job rows carry the registry's `timeout_sec` and `max_concurrent`** (migration 0005), written by the web when it creates the job. The worker then needs no copy of the registry.
- **Every upload is probed before any job may use it** (`probe.py`, `11` → File intake).
  - ffprobe runs under the sandbox; its container must be one the claimed MIME type allows, so a WebM sent as `video/mp4` is refused.
  - Frames are capped at 100 MP and media at 24 h.
  - The record (container, streams, duration, rate, rotation, a "maybe VFR" hint, never a filename) goes into `uploads.probe`; a refusal into `uploads.probe_error` as an API code.
  - Tool limits (duration, size by tier) are the web's to apply at quote time: it has the registry.
- **The sandbox** (`sandbox.py`, `11` → ffmpeg and native tools):
  - Argument lists only, and a clean environment (no storage keys, database URL or proxy).
  - `prlimit` for address space, file size and open files, and no core dumps. It's a wrapper command, not `preexec_fn`, which isn't safe once the worker has threads.
  - Its own process group, killed as a whole on timeout or cancel; stdin closed.
  - ffmpeg always runs with `-protocol_whitelist file,pipe` and `-nostdin`.
  - Still to come with production hosting: no network namespace for the ffmpeg process and a seccomp profile. Those are container settings, not code.
- **Inputs live exactly as long as their job.** The runner's `finally` deletes the temp dir and the input object, whatever the outcome. Only a worker that dies mid-job leaves it, so another worker can retry. A reaped job that fails for good, or an expired one, loses its input at once.
- **The retention sweeper** runs every 5 min under the scheduler's lock (`retention.py`):
  - It deletes outputs 60 min after their job finished.
  - It aborts multipart uploads not completed within the hour: ours, and any storage still lists.
  - It deletes completed uploads no job used before they expired.
  - It then lists the bucket, and alerts on anything older than 2 h or any upload open longer than 2 h. `sweeper_stale` alerts when it hasn't finished in 30 min.
  - The lifecycle rules are checked nightly: "not supported" on the local gateway (`12` → M4), a missing-rules alert on R2.
- **ffmpeg is Debian's package** in the worker image (a GPL build, never `nonfree`); CI's worker job installs Ubuntu's for the tests. The register entry now says so.
- **Processors are keyed by tool id** (`processors/__init__.py`: `estimate`, `run(ctx)`, `JobFailed` for errors the user sees). The first real ones come with the tools (M4, part 4); the tests use a remux processor on files ffmpeg generates, so no binary fixtures are committed.

**Why:** `docs/12` → M4 ("claim/heartbeat/reaper, processor interface, ffmpeg sandboxing per 11"; "Retention: immediate input deletion, 60-min output sweeper (also aborts stale multipart uploads)… lifecycle check… reports not supported locally"; done-when: "input is gone from storage immediately after, output gone within the hour; killing a worker mid-job requeues it; malformed-file fixtures fail cleanly"), `docs/01` → Queue, Workers, Retention, `docs/11`.
**Reverse:** `WORKER_SLOTS=0` isn't allowed; to stop job processing, stop the worker. The sweep interval and TTLs are constants at the top of `retention.py` and `jobqueue.py`.

## 2026-09-30 · Server jobs over the API: quotes, what pays, and the per-account limits (M4)

**Decision:**
- **Every check that decides whether and how a job runs is on the server, from the worker's probe** (`apps/web/src/server/jobs.ts`):
  - The tool must be live with its server path on.
  - The upload must be the caller's, complete, probed without a refusal, made for this tool, and not used by another job.
  - The caller's tier limits (duration, pixels) apply.
  - The options pass the tool's Zod schema (`@etb/registry/options`; unknown keys refused, defaults filled in).
  - The price comes from the registry's rule and the probe (`priceOf`).
- **A quote waits up to 8 s for the probe**, then answers `202 { status: "probing" }` with `Retry-After: 1`. A probe refusal is a `422` with the probe's code.
- **`POST /jobs` repeats every check, and refuses a changed price** with `409 CONFLICT` and the new `credits`, so the user confirms again.
  - An `Idempotency-Key` (8 to 128 printable characters) returns the same job on a repeat.
  - Each upload feeds one job.
  - Creates for one account run one at a time (a transaction-scoped advisory lock), so a double click can't beat the limits.
- **What pays is recorded on the job, in a new `funding` column** (migration 0006):
  - `none` for a price of 0.
  - `daily` for one of the 3 free jobs a day a never-paid account gets (`config/business.ts`).
  - `credits` otherwise: the price is reserved with `applyCredit` in the transaction that creates the job.
  - Paid-credit jobs queue at priority 1, free ones at 0.
- **"Small job" (`docs/05` → Free allowance) means within the tool's free-tier server limits.** Those are what a never-paid account can send at all, so every job it runs is small. Once today's free jobs are used, a never-paid account pays in credits (the welcome grant arrives in M5) and gets `429 QUOTA_EXCEEDED` without them. A paid account without enough credits gets `402 INSUFFICIENT_CREDITS`.
- **The allowance is counted from job rows** (`funding = 'daily'`, created today UTC, not failed, cancelled or expired), not from the `free_quota` table in `docs/04`.
  - A counter would have to be given back on every failure, cancel and expiry, by the worker and by the web. Counting rows gives the slot back by itself and can't drift.
  - `free_quota` stays in the schema, unused. Free previews (Wave 2) will count as daily jobs too.
  - The day is UTC, like every other date the API shows.
- **Per-account concurrency:** at most 2 jobs queued or running (4 once paid), `429 RATE_LIMITED`. Checked under the same lock.
- **Cancel** stops a queued or running job and releases its credits in the same transaction. A queued job's input is deleted at once; a running job's worker notices within 5 s and deletes it.
- **Progress:** `GET /jobs/:id/events` is server-sent events. It polls the job row every second and sends `progress` on any change, `done` with the whole job at the end, and a comment every 20 s. A stream closes after 15 min; EventSource reconnects. `Cache-Control: no-transform` keeps compression from holding events back.
- **Results:** `GET /jobs/:id` presigns a 10-minute download URL named `<tool id>.<ext>` on each call, with `expires_at` 60 min after the job finished (when the sweeper deletes it). A failed job says what went wrong in plain words and whether credits came back.
- `estimate_seconds` is `null` until tools have measured runtimes (M4, part 4).

**Why:** `docs/12` → M4 ("Credits reserve → capture/release wired … free-tier daily allowance … per-user concurrency caps"), `docs/06` → Endpoints and Job lifecycle, `docs/05` → Free allowance and Abuse.
**Reverse:** to use `free_quota`, write it in `createJob`'s transaction and give it back wherever a job fails, is cancelled or expires (web and worker). The limits are in `config/business.ts`.

## 2026-10-01 · Compress Video on our servers, and the server offer on tool pages (M4)

**Decision:**
- **The server offer lives in the ToolShell** (`docs/02` → Routing); a tool page only says how its options map to the API's (`toServerOptions` in `compress-video.tsx`). The page gets the server path from the registry only when an admin has switched it on (`ShellTool.server`, from `hasServerPath()`); the static export never has it.
- **When the offer shows:**
  - A file over the browser's limit: the drop zone now takes files up to the server's paid limit, and the shell offers the server instead of refusing.
  - A file the browser can't read.
  - A browser run that fails: "Use our servers" on the error.
  - Within the browser's limits, the person can choose it: "Use our servers instead".
- **The offer explains before anything is sent:** why, what it costs this account (a free daily job, or about N credits from the file's length with `priceOf`, or the tier's size limit), and that the file is deleted when the job ends and the result within the hour. Signed out, it links to sign-in and back. Nothing is uploaded until the person presses "Compress on our servers".
- **The server's price is final.** When it differs from what the offer said (or the offer said free and it isn't), a dialog asks again. Declining cancels the upload.
- **The browser client** (`apps/web/src/lib/server-run.ts`):
  - It uploads 4 parts at a time, re-signing a part URL after 12 minutes or a refusal, 3 tries a part.
  - It asks for the quote until the probe is done, starts the job with an Idempotency-Key, and follows it by server-sent events (polling if they fail).
  - It downloads the result with progress and names it from the original, on the page. The file's name never reaches the API.
  - Cancel deletes the upload or cancels the job.
  - It lives in the app, not `packages/api-client`, which stays empty until M6 as `docs/12` says.
- **`GET /api/v1/me`** (`docs/06`) answers the tier, balance and free jobs left; job results now carry the output's size, picture size and notes. A processor's own failures (`TARGET_TOO_SMALL`, `NO_VIDEO`) show its sentence; every other code shows a fixed one.
- **The server Compress Video** (`processors/compress_video.py`) plans like the browser tool (`packages/engines/src/video/compress.ts`): the same bitrate sum, bits-per-pixel floor and Auto step-down, so the same settings give the same picture size either way.
  - Size targets are two-pass (x264, x265, VP9). AV1 runs one pass: SVT-AV1 aims well at a bitrate alone.
  - An overshoot re-runs the second pass with the bitrate scaled down.
  - Quality levels are CRFs.
  - The output is always 8-bit 4:2:0 so it plays everywhere, with metadata and chapters dropped.
  - Audio is copied when the container takes it, else AAC 128 kbps (MP4) or Opus 96 kbps (WebM).
  - The probe now records the audio bitrate (192 kbps assumed when a container doesn't say).
- **The API's Compress Video options follow the browser tool's settings**: `mode`, `targetMb`, `quality`, `resolution`, `fps`, `codec` (`h264`, `h265`, `av1`, `vp9`), `audio`.

**Why:** `docs/12` → M4 ("Hybrid routing UI (server fallback offer with reason)", "large-file video compress"; done-when: "a 1 GB video compresses on the server end-to-end with live progress"), `docs/02` → Routing ("Never upload a file the user didn't explicitly agree to upload"), `tools/video.md` → V02.
**Reverse:** switch the server path off in Admin → Tools; the page goes back to browser-only within 30 s. The offer is `ServerNotice` and `runOnServer` in the ToolShell.

## 2026-10-01 · VFR to CFR, server-only tools, the admin's Jobs page and job stats (M4)

**Decision:**
- **Server-only tools stay `soon` in the registry; an admin switches each one on** (Admin → Tools → status `beta` or `live`) in the server build, the way a hybrid tool's server path is switched on. The static export has no API, so it never offers a server path, and its pages for these tools stay "coming soon".
- **The ToolShell runs server-only tools:** a tool view with no browser engine gets the server offer as soon as a file is in, with the tool's own reason ("Precise frame timing needs ffmpeg"), and no browser button.
- **VFR to CFR (V15)** on the worker (`processors/vfr_to_cfr.py`):
  - ffmpeg's fps filter puts each frame on the new clock by its timestamp.
  - The sound is resampled against its own timestamps and re-encoded (AAC 256 kbps), so it ends with the picture.
  - Visually lossless by default (CRF 16), with a keyframe every second for scrubbing.
  - A 10-bit source stays 10-bit as H.265, keeping its colour; 8-bit becomes H.264.
  - Auto picks the standard rate nearest the video's average (23.976 to 60).
- **Variable frame rate is read from the frames' own clock:** the probe reads the first minute's packet times. A frame gap more than 25 % off the usual one is irregular; a few in a hundred is VFR. The header's average-vs-real hint stays as the fallback.
- **"Already CFR? No charge"** (`tools/video.md` → V15): the quote refuses a file the probe found constant with `422 NOTHING_TO_DO`, before any job exists. The upload is deleted at once. The page warns before upload when the browser can already tell.
- **Admin → Jobs** (`docs/07`): a list filtered by tool, status, source, the user's email and the day, 50 a page.
  - The detail shows metadata, options, the probe, timings, attempts, worker, error and credits. It never links either file.
  - Cancel gives the credits back (the same path as the user's cancel, with the audit row in its transaction).
  - Retry runs an ended job again only while its input is still in storage. That's rare, since inputs go when jobs end, and the retry is on us: no credits, no free job.
- **Job stats:** at 03:00 Tashkent the worker sums up yesterday's server jobs by tool into `tool_stats_daily`: jobs, failures, p50 and p95 run time, GPU seconds, credits. A job that used a GPU counts as `server-gpu`. Running it again rewrites the day.
  - The dashboard adds waiting and running now, p95 wait and run time over 24 h, failures by tool, and the daily table.
- **Runbooks** (`docs/runbooks/`): every alert, disabling a tool, a stuck job, draining workers, restoring the database, rotating secrets, and a breach template. The webhook page waits for M5.
- **Burn Subtitles is its own part:** it takes a second file (the subtitles) beside the video, which the upload and job APIs don't carry yet, and bundled OFL fonts in the worker image.

**Why:** `docs/12` → M4 ("First server-cpu tools from Wave 2", "Admin Jobs page, job stats, failure alerts", "Runbooks folder started"), `docs/07` → Jobs and Dashboard, `docs/11` → Backups and recovery, `tools/video.md` → V15.
**Reverse:** set the tool back to `soon` in Admin → Tools. Drop `tool_stats` from the worker's `DAILY` to stop the nightly sums.

## 2026-10-01 · Burn Subtitles, and a second file beside the main one (M4)

**Decision:**
- **A tool can take more files than its main one**, each as an upload of its own, named in an option (`@etb/registry/options` → `uploadOptions`: Burn Subtitles' `subtitles`).
  - The jobs API checks each like the main one: the caller's, made for this tool, a subtitle type, unused, probed.
  - Their keys go into a new `jobs.extra_input_keys` (migration 0007) and their probes into `input_meta.extras`.
  - The worker downloads them beside the input and deletes them with it, whatever happens. The sweeper and cancel treat them the same way.
  - Rows never hold the subtitles' text, only random keys and the probe.
- **Subtitle files go through the same upload API** (`application/x-subrip`, `text/vtt`, `text/x-ssa`), capped at 5 MB. The probe accepts them only as one subtitle stream of the claimed kind. The page types them by extension, since browsers rarely do.
- **On the page, a `file` option** (a picker beside the settings) holds the second file. The run takes the File itself from memory: fetching its `blob:` URL would need a CSP exception. The run button waits until it's chosen.
- **Burn Subtitles (V16)** on the worker (`processors/burn_subtitles.py`):
  - libass through ffmpeg's subtitles filter, then H.264 (CRF 18), with AAC copied when it can be.
  - SRT and VTT take the person's style: Noto Sans, Serif or Sans Mono; small, medium or large; color; no, thin or thick outline, or a half-clear background box; top or bottom; full or narrow lines.
  - ASS keeps its own styles.
  - A subtitle file that isn't UTF-8 is read as Windows-1251 when that gives Cyrillic, else Windows-1252.
- **libass reads `force_style`'s alignment the legacy way** (2 bottom centre, 6 top centre), not the numpad way ASS files use. Found by rendering, and the tests check positions by pixels.
- **Fonts:** Debian's `fonts-noto-core` (OFL-1.1) in the worker image and CI's worker job: Latin, Cyrillic and Greek in sans, serif and mono. Registered in `docs/13`.

**Why:** `docs/12` → M4 ("First server-cpu tools from Wave 2 (e.g. … burn subtitles)"), `tools/video.md` → V16, `docs/08` (no file contents in rows).
**Reverse:** set Burn Subtitles back to `soon` in Admin → Tools. Tools without `uploadOptions` never see extra inputs.

## 2026-10-01 · M6 (public API) before M5 (credits and payments)

**Decision:** After M4, work moves to M6. M5 waits.
**Why:** `docs/12` makes M5 require Go public (Paddle onboards only a live, reviewed site), and Go public needs Astro: the domain, hosting, Paddle and real secrets (`CLAUDE.md` → off-limits). M6 needs none of that: its done-when ("a script with only an API key can run any server tool end-to-end following the docs") runs on the local stack with M4's server tools. The checkout endpoint (`POST /credits/checkout`) stays with M5.
**Reverse:** nothing to undo; M5 starts whenever Go public is done, and nothing in M6 depends on it.

## 2026-10-01 · API keys: format, scopes, and who may call from where (M6)

**Decision:**
- **Keys are `etb_live_` and 32 characters from [0-9A-Za-z]** (about 190 bits). They're shown once, when made. We keep the SHA-256 and the first 8 characters after the prefix (`etb_live_ab12cd34`), so a key can be named but never shown again.
- **Three scopes,** as `docs/04` lists them:
  - `jobs:read`: list and read jobs, their progress, and results.
  - `jobs:write`: uploads, quotes, starting and cancelling jobs.
  - `account:read`: `/me`.
  - The website's session cookie can do all three.
- **10 live keys per account.** Revoked keys don’t count; their rows stay, marked revoked.
- **One check for every route** (`requireCaller(request, scope)` in `server/api.ts`):
  - If an `Authorization` header is present, it must hold a live key with the scope: 401 (with `WWW-Authenticate: Bearer`) otherwise, 403 for a missing scope. It never falls back to the cookie.
  - Without the header, the session cookie, and a write must come from our origin, as before.
- **CORS:** every `/api/v1` answer has `Access-Control-Allow-Origin: *` and never `Allow-Credentials`. Each route answers preflights (`OPTIONS`).
  - Scripts and other sites can call with a key.
  - A browser never hands another site an answer made with our cookie. The cookie is SameSite=Lax, so it isn't even sent.
- **Rate limits count per key,** or per account for the website. The account's own caps hold whatever the caller: concurrent jobs, unfinished uploads, the free daily jobs.
- **`last_used_at` is written at most once a minute.** Key events are logged by key and account id, never the key itself.

**Why:** `docs/06` → Auth ("Keys are stored hashed; revocable; `last_used_at` updated at most once per minute") and → Basics → CORS ("API-key auth allowed from any origin").
**Reverse:** to close cross-origin use, drop the CORS headers in `route()`. To turn keys off, have `requireCaller` refuse the `Authorization` header.

## 2026-10-01 · The panel's connect flow (M6)

**Decision:**
- **RFC 8628's device grant, with our error format.** The polling states are problem+json codes (`AUTHORIZATION_PENDING`, `SLOW_DOWN`, `ACCESS_DENIED`, `EXPIRED_TOKEN`), not OAuth's `{ error }`, so the panel handles one error shape everywhere (`docs/06` → Basics).
- **The short code is 8 of 20 consonants** (`BCDFGHJKLMNPQRSTVWXZ`, about 35 bits), shown `BCDF-GHJK`. No vowels means no words; case, spaces and the dash don't matter when typed. It lives 10 minutes.
- **The device code is 32 random bytes,** stored as a SHA-256 only.
- **The key is made when the panel collects it,** not when the person approves. So no key is ever stored in the clear, not even between approval and the panel's next poll. Collecting spends the code.
- **`/connect` is server-build only and needs sign-in.** Signed out, the panel's link goes through sign-in and back to the code. The page:
  - Names the requesting app as it calls itself, the account it would join, and the key's scopes.
  - Says to go on only if you just started connecting yourself.
  - Refuses to approve when the account already has 10 keys.
- **The panel's key** is named after the app ("Premiere panel" by default; any name up to 60 characters) and has the three panel scopes. It's revoked like any key, in Account → API keys.
- **Codes are deleted a day after they expire** by the worker's nightly purge, and with the rest of an account's sign-in data by the 30-day scrub.

**Why:** `docs/06` → Auth ("panel calls `POST /auth/device` → shows a short code + opens `/connect` …").
**Reverse:** without a panel, nothing calls these endpoints. To close them, have `POST /api/v1/auth/device` answer 404.

## 2026-10-01 · One set of API schemas, the OpenAPI document and /developers (M6)

**Decision:**
- **The schemas live in `@etb/core/api`** (`packages/core/src/api/`), not a top-level `api-schemas.ts`:
  - Every request and answer body as Zod, with snake_case field names.
  - The routes read requests with them. Their answers are typed against them (`Promise<Job>`, `satisfies Upload`), so a change that drifts fails `tsc`.
  - Core now depends on `@etb/registry` for the tool, limits and price schemas. The registry depends only on Zod, so there's no cycle.
- **The OpenAPI 3.1 document is generated, with no new dependency:**
  - Zod 4's own `z.toJSONSchema` turns every schema in the `api` registry into a component, with `$ref`s between them.
  - The paths come from one list, `ENDPOINTS` (method, path, scope, bodies, problem codes).
  - `GET /api/v1/openapi.json` serves it, built once per process.
- **`/developers` is made from the same list** (server build only: the static site has no API):
  - Keys and scopes.
  - A curl walkthrough of a whole job.
  - Connecting an app, errors and limits, every endpoint with the scope it needs, and versioning.
  - Account → API keys links to it.
- **New endpoints:**
  - `GET /tools/:id`: a tool with its options as JSON Schema (input side, so defaults aren't required) and the extra uploads it takes.
  - `GET /me/credits`: the ledger, 50 a page by cursor, without admin notes or purchase ids.
  - `GET /tools` gains `server`: our servers run the tool now.
- **Jobs started with a key are `source = 'api'`;** the website's stay `web`.
- **Two checks against drift:**
  - A unit test that every listed endpoint has its route file, exporting the method and `OPTIONS`.
  - An end-to-end test that parses real answers with the schemas.

**Why:** `docs/06` → Basics ("Schemas defined once in Zod → OpenAPI 3.1 generated … published at `/api/v1/openapi.json` and a docs page at `/developers`").
**Reverse:** to stop publishing the description, remove the `openapi.json` route and `/developers`. The schemas stay, since the routes read requests with them.

## 2026-10-01 · The typed client, and a script that needs only a key (M6)

**Decision:**
- **`@etb/api-client` is hand-written over the shared types, not generated.** It imports only types from `@etb/core/api`, so it adds no runtime code (no Zod) to the website's bundles or the panel. Answers are trusted as the API's own; the end-to-end contract test is what checks them.
  - It has a call for each endpoint, and problem answers become `ApiError` with the stable `code`.
  - `uploadFile` sends parts in parallel, re-signs URLs older than 12 minutes or refused ones, retries a part 3 times, and cancels the upload if it fails.
  - `readyQuote` asks until the probe is done; `finished` polls a job to its end.
  - Without a key it sends the site's session cookie (same origin only).
- **The website's server path uses it** (`apps/web/src/lib/server-run.ts`). Following a job's progress (EventSource) and the result's download with progress stay in the app, since both are browser-only.
- **The example script is `apps/web/public/examples/run-tool.mjs`:**
  - Node 20+, no packages, so anyone can run it without our workspace.
  - `/developers` offers it for download at `/examples/run-tool.mjs`, beside the curl walkthrough.
  - An option written `@path` is a file uploaded on its own, as Burn Subtitles' subtitle file needs.
  - M6's done-when is tested by running it as a separate Node process with only a key, the test playing the worker. It was also run by hand against the local stack with the real worker.

**Why:** `docs/12` → M6 ("`api-client` package used by the web app for server tools"; done when "a script with only an API key can run any server tool end-to-end following the docs").
**Reverse:** the client is one file; `server-run.ts` can go back to plain `fetch` calls.

## 2026-10-01 · An upload whose file is gone is refused, not retried (M4 fix)

**Decision:**
- When the probe finds no object behind a completed upload (storage answers 404 or NoSuchKey), the worker marks it once: `probe_error = 'MISSING'`. The jobs API answers `409 UPLOAD_INCOMPLETE`, "The upload is gone. Upload the file again." This happens when the upload was cancelled or swept.
- Any other storage error leaves the upload unprobed and lets the job slot wait 5 s, as it does for a storage outage.
**Why:** found on the local stack. The probe took the oldest unprobed upload, retried a missing one at once and forever (2,477 tries in 2 minutes), and so never reached the uploads behind it.
**Reverse:** remove the `MISSING` branch in `probe.py`; the slot then retries every 5 s instead of refusing.

## 2026-10-01 · M8 starts while M5 and M7 wait

**Decision:** After M6, work moves to M8: the rest of Wave 2, one tool or a small group per PR, `beta` first. Browser tools come first, then CPU server tools.
**Why:**
- M5 needs Go public, which needs Astro (see "M6 before M5").
- M7, the Premiere panel, is done when auto-subtitles and stems land in a bin. Those are M5's GPU tools, and checking them needs Premiere itself, which this build environment doesn't have.
- M8's browser and CPU tools need neither.
**Reverse:** nothing to undo. M5 starts when Go public is done; M7 after M5's GPU tools.

## 2026-10-01 · Contrast Checker and the DPI calculator (M8)

**Decision:**
- **Contrast Checker (C04):**
  - The ratio is shown cut to two decimals, never rounded up, so a pair that just misses a threshold never reads as exactly it. Pass or fail always uses the exact ratio.
  - Transparent colors are measured as a page shows them: the text over the background, and the background over white.
  - The suggested fix keeps the color's hue and moves only its Oklch lightness, darker or lighter, whichever changes it least (Oklab ΔE). Chroma is eased only where sRGB runs out, and greys stay grey.
  - The final 8-bit value is checked against the target again, so rounding can't push it back under.
  - Suggestions are given for both the text and the background, for the chosen aim: AA, AAA, or large text and UI at 3:1.
- **Print Size & DPI (U03):**
  - Pixels for a print are rounded to the nearest pixel, as the standard tables have them (A4 at 300 DPI: 2480 × 3508).
  - Quality is judged on the whole DPI as shown: 299.96 counts as 300.
  - "Largest paper" turns the paper to match the image.
  - "Use an image's size" decodes the image in the browser (`createImageBitmap`); the file never leaves the page.

**Why:** `tools/color.md` → C04, `tools/utility.md` → U03.
**Reverse:** the rules live in `packages/core/src/color/contrast.ts` and `calc/print.ts`, with their tests.

## 2026-10-01 · Split Image into Grid (M8)

**Decision:**
- **The image worker cuts the tiles.** It decodes once, crops each tile pixel for pixel, encodes it, adds the chosen metadata, and answers one ZIP.
  - The ZIP is stored, not deflated: images don't shrink.
  - fflate, already in the register for batch ZIPs, now also runs in the worker.
  - Tiles skip PNG's slow lossless pass: a dozen would take a minute.
- **Grids:** presets 3 × 3, 1 × 2, 1 × 3, 1 × 4, 1 × 10, 2 × 2, 2 × 3, 3 × 2, or custom up to 10 × 10. At most 100 tiles, none under 16 px.
- **Gaps**, the spec's "gap handling": "Feed gaps" leaves out a strip 2.5 % of a tile wide between tiles, so a picture lines up across a profile grid's own gaps (about 3 px between 120-odd px posts).
- **Leftover pixels:** "Equal size" (the default) trims them evenly from the edges. "Every pixel" lets tiles differ by 1 px.
- **Naming:** `name_01_r1c1.png`.
  - The number follows the chosen order: row by row, or posting order (the last tile first, so a profile grid reads right after the final post).
  - The row and column are always in the name.
- **The result card for a non-image output:** the ToolShell shows a file card instead of a before/after when the result isn't an image.

**Why:** `tools/photo.md` → P14.
**Reverse:** the grid rules are in `packages/engines/src/image/grid.ts`, with tests.

## 2026-10-01 · Photo Metadata Viewer & Remover (M8)

**Decision:**
- **Four choices:**
  - Everything (the default).
  - Location only: GPS, plus XMP or IPTC that names a place.
  - All but camera and settings: make, model, lens and exposure stay; dates, people, serial numbers and place go.
  - Nothing, just look.
  - The photo shows its metadata the moment it's dropped, and a change of choice runs again.
- **Always kept:** the orientation (or a phone photo shows turned) and the colour profile (or colours shift). Neither identifies anyone. An upright photo keeps no EXIF at all.
- **JPEG, PNG and WebP are rewritten around their pixels,** which stay byte for byte:
  - JPEG: segments before the scan are kept, rewritten or dropped. Adobe's APP14 (colour transform) and the ICC profile stay.
  - PNG: chunks, with fresh CRCs. Colour chunks stay; text, XMP and `tIME` go.
  - WebP: RIFF chunks, with VP8X's flags and the RIFF size fixed.
- **EXIF is rebuilt, not patched.** The kept entries are written into a new TIFF block with their original bytes and byte order. The thumbnail (a preview that can show the uncropped original) and the maker's private notes (which may hold serial numbers, and whose inner offsets break when moved) are never written back.
- **Anything after a JPEG's end** (motion photos, depth maps, HDR layers) goes with any removal, since it can carry its own EXIF. So does the MPF index that points to it; an Ultra HDR photo becomes a plain one.
- **HEIC, AVIF, TIFF, GIF and BMP** can't be edited in place here. They're saved as PNG, pixel for pixel, with no metadata, and the page says so.
- **The report** lists every field by group and marks what was removed. It's computed in the browser; nothing is sent.
- **`hosts:check` exempts XMP's identifiers** (`http://ns.adobe.com/xap/1.0/` and its extension), as it already did XML namespaces: they're names at the start of an XMP block, never fetched.

**Why:** `tools/photo.md` → P15 ("removal re-writes the container without re-encoding pixels where the format allows").
**Reverse:** the rules are in `packages/engines/src/image/metadata.ts` and `tiff.ts`, with tests.

## 2026-10-01 · Social Media Image Resizer (M8)

**Decision:**
- **The sizes** live in `packages/core/src/social-presets.ts`, each with a `verifiedOn` date (the spec's `verified_on`):
  - 14 sizes on 7 platforms: the spec's list, plus Instagram 3:4 (1080 × 1440, whole in the profile grid since 2025) and LinkedIn's company page cover (1128 × 191).
  - Facebook's cover is 851 × 315, the size Facebook itself recommends.
  - All were checked on 2026-10-01 against current published size guides. The platforms' own help pages (Google, Meta) can't be reached from the build environment, so Astro should confirm them there at the first quarterly review.
  - A size's `note` says what the platform covers or crops (Story text margins, YouTube's 1546 × 423 safe area on phones, profile photos over X and LinkedIn headers), and shows in the result notes.
- **Upload limits are kept, not just shown:** YouTube thumbnail 2 MB, YouTube banner 6 MB, X post 5 MB.
  - JPG, WebP and AVIF over a limit get the highest quality that fits (a binary search, as Compress does, never below 40), and the notes say so.
  - A PNG over a limit is left as made, and the notes say to choose JPG or WebP.
  - Room is left for the EXIF that goes back in after the encode.
- **Fill, crop** takes the largest window of the size's shape around the focal point, as far as the edges allow. Fit keeps the whole image on a blurred copy of itself, or on a picked color.
- **The blur** is made at a sixteenth of the size: three box blurs each way (close to a Gaussian), then scaled up. A 2560 px banner takes a fraction of a second and looks the same in every browser. Canvas `filter` isn't used, as Safari's support is recent.
- **Resampling** uses the same Lanczos filter as Resize Image. A size bigger than the image is enlarged, with a note when it's more than 5%.
- **One size downloads as the image,** named with the size (`photo_instagram-square-1080x1080.jpg`). Two or more download as a stored ZIP, each file named `photo-{size id}-{w}x{h}.ext`.
- **Shell additions,** reusable by other tools:
  - A `checklist` option kind: grouped checkboxes with the numbers beside them; on phones, a settings row summarising the picks.
  - A `focus` preset: a focal-point picker with an outline per picked size. Click, tap or drag to move it; arrow keys move it 2% (Shift 10%), Home centres it.
  - `EngineOutput.nameSuffix`: an engine can name the download after the run.
  - A "Back to the settings" link on the result, to change the sizes or the point and run again.
  - A new image resets the focal point to the centre.

**Why:** `tools/photo.md` → P13 ("preset table lives in `packages/core/social-presets.ts` with a `verified_on` date per preset; review quarterly").
**Reverse:** the sizes are one table, and the framing is in `packages/engines/src/image/social.ts`, with tests.

## 2026-10-01 · Loudness Meter and Normalize Loudness (M8)

**Decision:**
- **One in-house BS.1770-4 / EBU R128 implementation** in `packages/core/src/audio/loudness.ts`, shared by both tools and the panel:
  - K-weighting is designed per sample rate from the analogue prototypes (libebur128's constants), so it matches BS.1770's 48 kHz table and stays right at 44.1 and 96 kHz.
  - Channel weights: 1 for L, R and C, 1.41 for the surrounds, 0 for the LFE (WAV order, L R C LFE Ls Rs for 5.1).
  - Integrated: 400 ms blocks every 100 ms, gated at −70 LUFS and 10 LU below. Loudness range (Tech 3342): short-term every 100 ms, gated at −70 and 20 LU below, P95 − P10.
  - True peak: 4× oversampling below 96 kHz (2× below 192 kHz) with a 16-tap Kaiser-windowed sinc per phase, flat within 0.01 dB to a quarter of the sample rate. That's finer than BS.1770's 12-tap example filter, whose coefficients we didn't copy.
  - The meter skips the oversampling where a stretch's samples, times the most the filter can amplify, can't beat the peak found so far. The result is the same, and it's faster on music.
- **Checked against the EBU's own conformance signals** (Tech 3341 cases 1-5, Tech 3342 cases 1-4) and **against pyloudnorm 0.1.1** (MIT):
  - pyloudnorm ran once, in a scratch environment, on four signals the tests regenerate: noise at 44.1 kHz, two tones mono, five channels, 96 kHz. All within 0.1 LU.
  - pyloudnorm is not a dependency, and nothing of it is in the repo but the four numbers.
- **The normaliser** measures once, keeping each millisecond's K-weighted energy and true peak, then plans in memory:
  - Gain alone when the peaks allow it.
  - Otherwise, with Gain + limiter (the default), a true-peak limiter with 5 ms look-ahead and about 80 ms release, aiming 0.1 dB under the ceiling. Each knot also covers 2 ms either side, for a timeline a frame off.
  - The gain is raised until the limited result, predicted from the per-ms energies, reaches the target.
  - With Gain only, the gain stops where the peaks reach the ceiling, and the notes say by how much the target was missed.
- **The normaliser writes, then measures what it wrote:** lossless output from the processed samples, MP3, M4A and OGG by decoding the encoded file. If encoding pushed the true peak over the ceiling, the notes say so.
  - The format is kept by default (MP3 stays MP3 at its bitrate). There's no dither on 16-bit output.
- **Targets the meter checks** (`targets.ts`):
  - Streaming, judged ±1 LU with a −1 dBTP recommendation: YouTube −14, Spotify −14, Apple Music −16.
  - Delivery specs: podcasts −16 ±1 LU (−1 dBTP); EBU R128 −23 ±0.5 LU (−1 dBTP); ATSC A/85 −24 ±2 LU (−2 dBTP).
  - Streaming verdicts say how much quieter the service will play a loud file. Netflix's dialogue-gated measure isn't covered: it needs speech detection.
- **The meter's download** is a text report, or the momentary and short-term loudness every 100 ms as a CSV.
- **The graph** is short-term loudness over time (at most 1,200 points, the loudest of each stretch), with the integrated level dashed. It's an SVG named for assistive tech, and the numbers are also in the facts and the report.
- **Shell:** an analyzer's facts can carry a unit, and an engine can return a `graph`.

**Why:** `tools/audio.md` → A05, A06 ("in-house implementation, validated against pyloudnorm in tests").
**Reverse:** the measurement and the plan are pure functions in `@etb/core`, with tests. The tools' pages and engines only decode, call them and encode.

## 2026-10-01 · A private live site before Go public, and the run that builds it

**Decision:** Astro's instruction of 2026-10-01. The site goes live now, privately, at the real domain, and only Astro can open it.
- **Phase 1** (with Astro, one step at a time): Cloudflare R2, Railway, Modal, sign-in email, Google sign-in, Cloudflare Access, the Paddle sandbox, Telegram, then the first deploy. Each step is checked from GitHub Actions before the next (`scripts/ops/verify.ts`, `.github/workflows/ops.yml`): this build environment can't reach Cloudflare, Railway, Modal or the domain itself.
- **Phase 2** (autonomous, until done): M5 complete with payments built and switched **off**, M5's GPU tools on Modal, the rest of M8, every tool after M8 including Wave 3, then a final pass. No stopping at milestone gates: each one updates `STATUS.md` and work continues. What only Astro can decide goes in `STATUS.md` → "Parked for Astro", with a recommended pick. Every merge deploys, and CI checks the live site through Access after each deploy; a broken production comes before anything else.
- **Not in this run:** M7 (the Premiere panel, which comes last), legal texts, Go public, removing Access. The panel work already started stays on the branch `claude/panel-wip`, unmerged.
- **This replaces `CLAUDE.md` rule 10's milestone gate for the run.** Every other non-negotiable still holds: licenses (6), no retained files (4), the append-only ledger (5).
- **Several PRs at once:** this session can now push branches other than its own (it couldn't on 2026-09-29, see "One PR at a time"), so independent topics get their own branches and PRs.

**Why:** Astro's instruction of 2026-10-01.
**Reverse:** take Access off (Go public), or stop the services in Railway and Modal.

## 2026-10-01 · Production: Railway, Cloudflare (DNS, R2, Access) and Modal

**Decision:** decided by Astro (2026-10-01):
- **Railway**, EU West (Amsterdam), Hobby plan, with a hard usage limit of $30 a month. Three services from this repo:
  - **web**: the Next.js server build (`ETB_TARGET=server`) serving every page. It applies the `_headers` file's security headers, CSP and COOP/COEP itself, as `pnpm preview` does for the static export.
  - **worker**: `apps/worker`.
  - **Postgres 18**: Railway's template if it's 18; otherwise the official `postgres:18` image with a volume.
  - Railway deploys every merge to `main`, after CI passes. Migrations run as the pre-deploy command, and the health check is `/readyz`.
- **Cloudflare:**
  - DNS for edittoolbelt.com.
  - R2 for files: the bucket `edittoolbelt-files` in the EU jurisdiction, with lifecycle rules of 1-day expiry and 1-day multipart abort (`01` → Retention).
  - Cloudflare Access (Zero Trust, free plan) in front of the whole domain, letting in Astro's email only, plus a service token for CI's checks of the live site.
- **GPU: Modal**, serverless, billed per second, scaling to zero, with a $20 monthly spend limit. It is the `ServerlessGpu` backend:
  - The worker calls Modal; Modal never calls us.
  - Files move through R2 presigned URLs, and nothing is kept on Modal.
  - L4 by default, T4 where it's enough.
  - `LocalGpu` stays, for development only.
- **Sign-in email:** an SMTP provider with a free tier, chosen at Phase 1 step 4 (its own entry).
- **Cloudflare Pages is not used while the site is private.** The static export and its deploy job stay, dormant (without `CLOUDFLARE_API_TOKEN` it's skipped); Go public revisits them.
- **Secrets** go straight from Astro into Railway's variables or GitHub's secrets, never through a chat or the repo. The checks read GitHub's copies:
  - `R2_*`: the app's own key.
  - `CF_READ_TOKEN`: a read-only Cloudflare token for R2, DNS and Access settings. The app's key is limited to objects, so it can't read the bucket's settings.
  - The Access service token.

**Why:** Astro's instruction of 2026-10-01. It replaces `01`'s "Production (from M5): EU VPS (Hetzner or equivalent)" plan: a managed platform with deploys from Git and a hard spending cap, and GPUs billed only while they run.
**Reverse:** the containers are plain Dockerfiles and the storage is S3-compatible, so moving to a VPS is new hosting and variables, not code. Modal sits behind `GpuBackend`.

## 2026-10-01 · How production is wired (Railway as code, Access checked twice)

**Decision:**
- **The Railway project is code:** `.railway/railway.ts` (Railway's infrastructure-as-code, applied by its CLI), not `railway.json`, which Railway stops reading on 2026-12-01.
  - **Postgres:** Railway's own Postgres image, which is 18.
  - **Services:** web and worker build from `main` once its GitHub checks pass.
  - **Region:** EU West for everything.
  - **Web:** migrations run as its pre-deploy command, and its health check is `/readyz`.
  - **No Railway hostname:** only the custom domains, edittoolbelt.com and www.
- **Applying it needs Astro.** CI shows the plan on every change, and the apply job waits for Astro's approval (the `railway` GitHub environment). Removing anything is never applied from CI.
- **Secrets are Railway shared variables** that Astro types in, referenced by name in the code. `docs/runbooks/production.md` lists every name.
- **The web service checks Cloudflare Access's token on every request** (`src/server/access.ts`), as well as Access itself:
  - In production, a request without a valid token for this application gets 403.
  - Without the Access settings, every request gets 503: the site fails closed.
  - Exempt: `/healthz` and `/readyz` (Railway's health check; they reveal nothing), and `/api/webhooks/*` (signed by the payment providers, 404 while payments are off).
- **`www` redirects to the apex** in the app (308), so Cloudflare needs no redirect rule.
- **The web image builds with placeholder secrets.** Only the values inlined into pages are build arguments: SITE_URL, the storage endpoint and analytics. The real secrets are read when the server starts.
- **The worker gets no volume.** Railway gives a paid plan's container 100 GB of its own disk. The largest upload is 10 GiB and the worker runs 2 jobs at once, which fits with room for outputs.
- **No staging environment** while one person uses the site: PRs are tested in CI against real Postgres and S3-compatible storage, and production is checked after each deploy.

**Why:**
- Infrastructure as code can be reviewed and reverted like the rest of the repo, and survives Railway's deprecation of the old file.
- A gated apply keeps infrastructure changes in Astro's hands.
- Checking the token in the app means a leaked Railway URL or a direct hit on Railway's edge still can't reach the site.

**Reverse:**
- Delete `.railway/` and configure the services in Railway's dashboard.
- Unset `CF_ACCESS_*` and change the proxy's production rule at Go public.

## 2026-10-01 · The GPU app on Modal: one Python project with the worker

**Decision:**
- **The Modal app lives in the worker's package** (`apps/worker/src/etb_worker/gpu/modal_app.py`), as the app `edittoolbelt-gpu`. The worker and the deploy share one Python project, one lockfile and one license check.
- **The `modal` client (Apache-2.0)** is a worker dependency:
  - The worker calls the app's functions by name and polls them; Modal never calls us.
  - The images Modal builds hold only what each function needs: the models, pinned by hash, come with M5's GPU tools.
- **Deploys:** CI deploys the app on every merge to `main` that touches it, then calls it (`.github/workflows/modal.yml`). Actions → Modal → Run workflow deploys by hand.
  - "gpu check" also runs a few seconds on a T4: the only call that costs GPU time outside a job.
  - A push to a `claude/ops-*` branch runs `ping` once without deploying, for the Phase 1 check.
- **The functions so far:** `ping` (no GPU) and `gpu_check` (T4, `max_containers=1`).

**Why:**
- `docs/01` → GPU backend and Astro's instruction of 2026-10-01: Modal is `ServerlessGpu`. L4 by default, T4 where it's enough; scale to zero; files only through presigned URLs.
- One project keeps the worker's calls and the functions they call in step.

**Reverse:** move `gpu/` to its own project with its own lockfile; the worker would then depend on `modal` only.

## 2026-10-02 · Approvals never stop the work

**Decision:** Astro's instruction of 2026-10-02.
- **The `railway` approval gate stays.** Every apply of `.railway/railway.ts` waits for Astro to approve it in GitHub, from a phone if Astro is away.
- **Work never pauses for an approval.** Request it, carry on with other tasks, and pick the deploy back up once it's approved.
- **What can't move until then** is listed in `STATUS.md` → "Waiting for Astro's approval"; everything else keeps being built.
- **Custom domains are added in Railway's dashboard.** Railway's configuration can't register them: its plan says so. `.railway/railway.ts` declares them once they exist, so later plans match.

**Why:** Astro's instruction; and Railway's own limit on custom domains.
**Reverse:** remove the `railway` environment's required reviewer (Settings → Environments), and the apply runs without waiting.

## 2026-10-02 · Grouped PRs for the finished tools

**Decision:** The 29 finished tool commits for the rest of M8 and Wave 3 merge as five PRs, not 29. Each PR is a run of consecutive commits, so what one relies on is already merged:
- A: Rotate & Flip Video and Resize Video for Social, Extract Frames, Remove Silence, Add or Replace Audio, Merge Audio, LUT Preview (with the shell fix that keeps a setting picked while a file is read).
- B: Merge Videos, Change Speed & Pitch, Change Video Speed, Watermark Images, Batch Rename Files.
- C: Draw on Image, Add Text to Image, Blur & Pixelate, Photo Editor, and the mobile work.
- D: Wave 3, part 1: Shutter Angle and Recording Storage calculators, File Checksum, Reverse Audio and Video, Loop Video, Split Audio, Gradient Generator.
- E: Wave 3, part 2: LUT Converter, Images to PDF, Collage Maker, Image to SVG, Audio to Video, Subtitle Editor.

Each tool keeps its own tests and its own entry here; each PR lists what it gathers.

**Why:**
- A CI run takes 25 to 45 minutes, and every merge deploys. 29 runs one after another would take a day.
- A group is still one topic: the tools of one milestone part.

**Reverse:** nothing to reverse; later work goes back to one topic per PR.

## 2026-10-01 · Fade In / Fade Out and Audio Channel Tools (M8)

**Decision:**
- **Fade In / Fade Out is a form, not a timeline** (its registry `ui` was `timeline`). The fades sit at the two ends of the whole file, so the timeline's in and out handles would only suggest a trim that doesn't happen. Fades inside a selection are Trim Audio's. The result's player is the preview.
- **The four curves have exact formulas,** in `packages/core/src/audio/fades.ts`, stated in the FAQ (gain from 0 to 1 through the fade):
  - Linear x.
  - Exponential (e^4x − 1)/(e^4 − 1): 0.119 halfway.
  - Logarithmic, its inverse, ln(1 + (e^4 − 1)x)/4: 0.831 halfway.
  - S-curve (1 − cos πx)/2: 0.5 halfway.
  - Each frame takes the curve at its centre, so a fade lasts exactly its frames.
- **Channel tools work on mono and stereo only.** A file with more channels is refused with its count; surround needs its own tool.
- **A stereo file is checked as it arrives** (its first two minutes): a silent side (under −70 dBFS RMS), dual-mono, one side inverted (correlation under −0.7), or ordinary stereo.
  - Dual-mono means the sides' difference is 45 dB under the quieter side, to allow for what MP3 or AAC leaves.
  - The page says what it found and picks the fix: the live side on both, mono from one side, or the right side inverted. A mono file is offered mono to stereo.
- **Mixed mono is (L + R) / 2,** so it can never clip; the notes say so.
- **Split gives a stored ZIP** of `name_L.ext` and `name_R.ext`, each mono, in the chosen format.
- **Both tools keep the source format** (MP3 at its own bitrate) unless another is picked. Downloads are named for what changed: `_faded`, `_mono`, `_stereo`, `_fixed`, `_swapped`, `_inverted`, `_split`.

**Why:** `tools/audio.md` → A07, A13.
**Reverse:** the maths is in `@etb/core` (`fades.ts`, `channels.ts`), with tests; the pages only pick options.

## 2026-10-02 · Smoke-testing production after each deploy

**Decision:**
- **The Smoke workflow runs when Railway reports a successful deploy to GitHub** (`deployment_status`), and by hand. It waits until `/healthz` names the deployed commit (20 minutes at most), then runs the `site` check of `scripts/ops/verify.ts` through Access with the CI service token: private without a token, `/readyz` green, the security headers, `www` redirecting.
- **Not on `push` or after CI (`workflow_run`).** Railway deploys a commit on `main` only once its check suites pass (`checkSuites`), so a check on the same commit that waits for the deploy would hold up the deploy it waits for, then fail and stop it.
- **No hourly run.** A scheduled run lands on the newest commit on `main`; if the site is down at that moment, its failed check would stop Railway deploying the fix. The worker's own heartbeats and alerts watch production between deploys.
- **It skips cleanly** until the service token is set (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`), like the Ops checks.
- `docs/runbooks/production.md` names every setting and where it lives, never a value.

**Why:** Astro's Phase 2 rule: every merge deploys, CI smoke-tests production through Access after each deploy, and fixing production comes first.
**Reverse:** delete `.github/workflows/smoke.yml`; `EXPECT_VERSION` is ignored when unset.

## 2026-10-02 · Where sign-in goes next: resolved like a browser, same origin only (M6 fix)

**Decision:**
- **`safeNext` resolves the path against SITE_URL with the WHATWG URL parser** (`apps/web/src/server/next-path.ts`) and keeps only a same-origin result, as its path, query and fragment. A string check alone missed what browsers do to a `Location`: they drop tabs and newlines, so `/sign-in?next=/%09/evil.example` sent a signed-in person to `//evil.example`.
- **Refused before that, and again once percent-decoded:** C0 and C1 control characters, backslashes, `%2F` and `%5C` in the path, and anything that collapses to `//` (`/.//evil.example`). This is Better Auth's own rule for relative callback URLs, so ours is never looser than the library's.
- Every `next` goes through it: the sign-in page's redirect when already signed in, and the `callbackURL` both sign-in actions hand Better Auth. `/connect` and the account pages only ever send to `/sign-in?next=` with a fixed path, and the admin's two-factor pages redirect to fixed paths only.

**Why:** a review of M6 found the open redirect (TAB in `next`).
**Reverse:** nothing to undo; `safeNext` is the only gate, and its tests list what it refuses.

## 2026-10-02 · One general rate limit in the API wrapper, and its headers on every answer (M6 fix)

**Decision:**
- **`route()` in `server/api.ts` owns the `RateLimit-*` headers.** Every limit a request is counted against is remembered for that request (`limit(request, key, max, windowSec)`), and the answer, errors included, gets the headers of the one it is closest to: the fewest calls left, then the longest wait. A 429 keeps its `Retry-After`.
- **A general budget sits under the routes' own limits:**
  - 600 calls a minute per key, or per account for the website, counted in `requireCaller` as soon as the caller is known, so a 403 for a missing scope carries it.
  - 300 a minute per address for the anonymous routes (`publicRoute`: `/tools`, `/tools/:id`, `openapi.json`, both device endpoints) and for any call whose key or session is refused, so every 401 carries it too.
  - The per-route limits stay as they were (uploads 30, quotes 60, jobs 30, …); cancel, complete and `DELETE /uploads/:id` have only the general one.
- **The limiter's map is bounded:** expired windows are swept every 500 calls, and past 50,000 windows the oldest go first (down to 45,000, so a flood doesn't sweep on every call). Before, it swept only above 10,000 and never shrank below that.
- **`readJson` refuses a body over its cap before reading it:** 413 at once when `Content-Length` says so, otherwise as soon as the bytes read pass the cap; the cap is in bytes, and a body that isn't UTF-8 is a 400.
- Preflights (`OPTIONS`) aren't counted and carry no `RateLimit-*` headers: a browser never shows their answer to the page.

**Why:** a review of M6 found the headers missing on `/tools`, `openapi.json`, cancel, complete, `DELETE /uploads/:id`, every 401 and 403, and any error thrown after a route's own limit, though `docs/06` promises them on every answer.
**Reverse:** the budgets are `CALLER_LIMIT` and `ADDRESS_LIMIT` in `server/api.ts`; `publicRoute` is `route(name, handler, true)`.

## 2026-10-02 · /connect: wrong codes lock out, and approving checks the account (M6 fix)

**Decision:**
- **A miss is any code that isn't waiting:** malformed, unknown, expired, used or declined, typed on `/connect` or sent to its approve and decline. Each gets the same "wrong or has expired" answer.
- **10 misses in 10 minutes, per account and per address, lock that account and that address out until the window ends** (RFC 8628 §5.1). While locked out nothing is looked up, the right code included, and the page says how many minutes are left. Counted in the process's limiter (`strike` / `lockoutLeft` in `server/rate-limit.ts`), like the API's limits; the address is `sourceOf`'s.
  - Fixed window, not sliding: simple, and 35 bits of code against 10 tries per 10 minutes per account and per address is out of reach either way.
  - Misses are logged as `device.code_missed` with the account ref only, never the code.
- **`decide()` refuses to approve (`full`) while the account has 10 live keys**, and leaves the code waiting, so the person can revoke one and come back; declining always works. The page already hid the button; a direct post could approve before.
- **`collectKey` answers `ACCESS_DENIED` for an approved code whose account was disabled or deleted since**, instead of making a key for it.
- **`@etb/db/testing` applies migrations under an advisory lock,** so the web app's database tests (`device.db.test.ts`) and `@etb/db`'s can run at once against one test database.

**Why:** a review of M6: `/connect` had no limit on guessing live codes, which a signed-in attacker could approve into their own account.
**Reverse:** `MISS_LIMIT` and `MISS_WINDOW_SEC` in `server/device.ts`.

## 2026-10-02 · Answers show no more than the caller's scopes (M6 fix)

**Decision:**
- **A job's `result` is left out for a caller without `jobs:read`,** wherever `jobs:write` alone reaches a job: cancelling one that already ended, and repeating a start with the `Idempotency-Key` of a job that has finished. The field is optional in `Job` and absent (not `null`), so "no result yet" and "not yours to see" stay different.
- **A quote's `balance`, `balance_after` and `free_jobs_left` are left out for a caller without `account:read`.** `can_start`, `blocked_by` and `funding` stay: they're what a key that may start jobs needs to decide, and they say nothing the start itself wouldn't.
- One place decides (`server/scoped.ts`: `jobFor`, `quoteFor`, over `holds(caller, scope)`); the website's session holds every scope, so the site is unchanged. The schemas say which scope each field needs, so the OpenAPI document does too.
- `run-tool.mjs` prints the balance only when the answer has it.

**Why:** a review of M6 confirmed a `jobs:write`-only key could get a presigned download URL from cancel or a repeated start, and the balance from a quote.
**Reverse:** have `jobFor` and `quoteFor` return what they're given.

## 2026-10-02 · 5 progress streams at once per account (M6 fix)

**Decision:**
- **`GET /jobs/:id/events` holds one of 5 slots per account while it reads the job** (`server/streams.ts`, counted in this process). The 6th gets `429 RATE_LIMITED` with `Retry-After: 15`; polling `GET /jobs/:id` still works, and the site's own page falls back to it when its EventSource fails.
- **Per account, not per key:** the database load is the account's, however many keys it has.
- **The slot goes back when the stream stops reading the job** (`jobEvents`' `onClose`): the job ended, the 15 minutes ran out, or the client left (within a poll, at most 2 s).
- **A stream reads a queued job every 2 s** instead of every second; a running one stays at 1 s, so progress shows as quickly as before.

**Why:** a review of M6: each stream reads the database every second for up to 15 minutes, and only stream starts were limited (30 a minute per key), so one key could hold hundreds open against a pool of 10 connections.
**Reverse:** `MAX_STREAMS` in `server/streams.ts`; `STREAM_POLL_QUEUED_MS` in `server/jobs.ts`.

## 2026-10-02 · An Idempotency-Key names one request body (M6 fix)

**Decision:**
- **The job keeps a SHA-256 of the request that first used its key** (`jobs.idempotency_hash`, migration `0009_job_idempotency_hash`, nullable). The body is hashed in a canonical form: `tool_id`, `upload_id`, `options` and `quote_credits`, object keys sorted at every level, no options the same as `{}` (`server/idempotency.ts`).
- **The same key with the same body answers the same job (200); with another body, `422 IDEMPOTENCY_KEY_REUSED`**, a problem whose `type` links to `/developers#idempotency`. 422, not 409, is what the IETF draft on the header asks for a reused key; it's a new stable code, which `docs/06` allows (adding is non-breaking). Jobs from before the column (hash null) answer as they did.
- **A retry that races the first try gets its job.** If starting fails with 409 `CONFLICT` (the upload already has a job, or the price changed) and the key now names a job, that job is the answer; the hash check still applies. Inside the create transaction the key is checked again under the account's lock, as before.
- `@etb/db/testing`'s locked migrations let `jobs.db.test.ts` run the real `createJob` against the test database, six tries at once.

**Why:** a review of M6 confirmed a reused key with a different body got the first job with 200, and found a retry arriving just before the first try committed could get "This upload already has a job".
**Reverse:** to drop the check, stop writing `idempotency_hash` (the column can stay null); the race retry is the `catch` in `createJob`.

## 2026-10-02 · The OpenAPI document lists every status a route answers (M6 fix)

**Decision:**
- **Each endpoint in `ENDPOINTS` names its problems by status** (`errors: { 409: ['CONFLICT', …] }`), and `problemsOf` adds what every endpoint of its kind answers: 429 `RATE_LIMITED` and 500 `INTERNAL` everywhere; 401 and 403 with a key or session; 400, 413 and 415 `BAD_REQUEST` with a JSON body. The document has one response per status, with its codes, and no `default`.
- **Other successes are listed too** (`also`): a quote's 202 `QuoteProbing`, a repeated start's 200. `Quote`'s two variants are components of their own (`QuoteProbing`, `QuoteReady`); `Quote` stays as their union for clients.
- **Corrected:** `DELETE /uploads/{id}` is 200 `UploadCancelled` (`{ status: "cancelled" }`), not 204; `/auth/device/token` can answer 409 `CONFLICT` (the account has 10 keys); both device endpoints document 429; cancelling a job never answers 409, so it no longer says so. Every response documents the `RateLimit-*` headers.
- **Checked twice:** a unit test that each operation's responses are exactly `statusesOf(endpoint)`, and the end-to-end contract test, which now sends each answer it sees through `expectDocumented`: its status must be listed for the route, a problem's code listed under that status, and the `RateLimit-*` headers present.

**Why:** a review of M6 found the document disagreeing with the routes (204 vs 200, the missing 202, 200, 409 and 429s).
**Reverse:** nothing to undo; to loosen the contract test, drop `expectDocumented`.
