# 2026-10-02 · The server build's CSP at launch: inline scripts and WebAssembly on public pages

**Decision:**

- **What each page gets in the server build** (what Railway runs; `apps/web/src/proxy.server.ts`, unit-tested in `src/proxy.test.ts`):
  - Public pages (home, hubs, tools, pair pages, legal pages, `/share`, 404): `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`, cacheable.
  - Personal pages (`/account`, `/sign-in`, `/admin`, `/connect`, `/credits`, and everything under them; one list in `src/lib/personal.ts`): a fresh nonce with `'strict-dynamic'` plus the theme script's hash, no `'unsafe-inline'`, no `'wasm-unsafe-eval'`, `Cache-Control: private, no-store`. `/credits/buy` adds Paddle's origins while Paddle is on.
  - Every page: `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `frame-src 'none'` (Paddle's on `/credits/buy`), `connect-src` limited to us, the models host, analytics and storage.
- **`'unsafe-inline'` stays on public pages at launch.** The static build's hashes can't follow the server build's pages:
  - Home, the hubs, every tool and every pair page are regenerated every 30 s from the tool flags (ISR). Next inlines each page's payload as `self.__next_f.push(…)` scripts. So the first admin change (status, maintenance message, surfaces) changes those scripts, and hashes written after `next build` stop matching: the page would load with its own scripts blocked.
  - The proxy runs before the page renders and never sees its HTML, so it can't hash the response either.
  - The pages fixed at build time (privacy, terms, cookies, refunds, licenses, contact, share, offline) could take hashes from a manifest written after `next build`. They're the pages with the least to protect, and it would put a second CSP mechanism into the build for them alone. Not done.
- **`'wasm-unsafe-eval'` is on every public page, in both builds**, not only on the tool routes that compile WebAssembly (`11` → CSP). Per route was tried, and it breaks tools:
  - A client-side navigation keeps the CSP of the document it started on.
  - Mediabunny's MP3 and FLAC encoders (every audio tool, Extract Audio, Remove Noise) compile their WebAssembly in blob workers, and a blob worker inherits the page's CSP.
  - So home → search → Audio Converter → MP3 fails: "Refused to compile or instantiate WebAssembly module". The static export already failed this way, measured in Chromium against `pnpm preview` before this change. MP3 pair pages failed even when opened directly (`/convert/wav-to-mp3`, `/convert/mp4-to-mp3`), because pair pages never got the WebAssembly marker.
  - The image, vector, checksum and AI engines run in workers loaded from a URL. Such a worker gets no page policy, so they work under any page.
  - Making every link into those tools a full page load (as for cross-origin isolated routes) would drop the in-memory "Use in another tool" handoff into them and hide them from `/share`.
  - So the static export now gives every page `'wasm-unsafe-eval'` (`apps/web/scripts/csp.ts`). The `etb-csp` marker, `needsWasm` and `WASM_ENGINES` are gone.
  - `e2e/security.spec.ts` checks it in both builds: Audio Converter reached from home by a client-side navigation, and `/convert/wav-to-mp3`, each make an MP3. Both tests failed on the static export before this change.
- **Personal pages stay without `'wasm-unsafe-eval'`.** A tool opened from one of them by a client-side navigation (the header search on `/account`) can't make MP3 or FLAC until the page is reloaded. That was already so. Those pages get the tightest policy, and the fix below makes the question go away.

**Why it's acceptable for now:**

- `'unsafe-inline'` matters only when someone can put markup into a page. Public pages render the registry and our own copy through React's escaping: no user HTML, nothing from the query string. They're the same for every visitor (cached) and carry no user data and no session.
- Every page that shows one person's data gets the nonce policy.
- `'wasm-unsafe-eval'` lets scripts that already run compile WebAssembly. It lets nothing new run.
- The whole site is behind Cloudflare Access until Go public: only Astro and CI reach it.

**What would remove them:**

- `'unsafe-inline'`: serve the public pages from the static export (per-page hashes, proven since M1) and keep the server for personal pages and the API, with tool status read at runtime instead of baked into the pages. Or make the hashes travel with each regenerated page: a Next cache handler that hashes the inline scripts as it stores the page, or a Cloudflare Worker that hashes each HTML response. Decide at Go public.
- `'wasm-unsafe-eval'`: run the MP3 and FLAC encoders in a worker loaded from a URL, as the image codecs are. Then no page needs it, in either build, which is better than per route.

**Why:** audit S3 (2026-10-02): production gives every public page `'unsafe-inline' 'wasm-unsafe-eval'`, and "The server build, and accounts (M3)" in `../DECISIONS.md` kept `'unsafe-inline'` only "until M5 decides how the server build serves public pages". `11` → CSP allows the `'unsafe-inline'` fallback if recorded.

Updates two entries in [`../DECISIONS.md`](../DECISIONS.md): "Hash-based CSP on static pages, proven" (2026-09-29: `'wasm-unsafe-eval'` only on working tool pages) and "The server build, and accounts (M3)" (2026-09-30: `'unsafe-inline'` until M5).

**Reverse:** the `buildCsp` call in `apps/web/src/proxy.server.ts`, and `wasm: true` in `apps/web/scripts/csp.ts`. Per-route WebAssembly needs the registry's `WASM_ENGINES` and `needsWasm` and the `etb-csp` marker back (git history), and only works once no WebAssembly compiles under a page's own CSP.
