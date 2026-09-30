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

**Decision:** The required "JS · …" job now also runs the initial-JS budget, Lighthouse CI on five pages (home, a hub, a coming-soon page, the isolated route, a legal page; mobile emulation, simulated slow 4G) and Playwright on Chromium, Firefox, WebKit and a phone viewport against the production build with the workshop: zero CSP violations, cross-origin isolation after arriving from the home search, axe (WCAG 2.2 AA, no serious or critical issues) on every page type in light and dark, keyboard (`/`, Esc cancels a run, skip link, arrow keys), every internal link resolves, all 75 tool pages exist and are `noindex`, theme persistence and each ToolShell demo. Lighthouse gates: performance ≥ 0.9, accessibility ≥ 0.95, best practices ≥ 0.9, lab LCP ≤ 2.5 s, CLS ≤ 0.05, TBT ≤ 150 ms, script transfer ≤ 160 KB. Local run: performance 0.98–0.99, accessibility 1.00, CLS ≈ 0, TBT ≤ 82 ms, LCP 1.8–2.4 s. Lab LCP is simulated on a slow 4G, 4× slower CPU; the 1.8 s p75 real-user budget in `10` is watched through the Web Vitals analytics events. Reports stay on disk, never uploaded. `pnpm preview` now compresses like Pages (Brotli/gzip), so transfer sizes are realistic.
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
