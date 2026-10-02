# 2026-10-02 · The server build has a service worker for the share target

**Decision:**
- **The server build (what Railway runs) serves `/sw.js` too**, from `apps/web/src/app/sw.js/route.server.ts`, and `ServiceWorker.tsx` registers it in both production builds.
- **It does two things:**
  - It takes Android's share target: the POST to `/share` is answered on the device, and the files are kept in the `etb-shared` cache for the `/share` page, as in the static build.
  - It caches models cache-first, in the same `etb-models` cache.
- **It caches no page and no script.** There is no precache, no offline page and no `/_next/static` cache, so a signed-in page always comes from the network. The generator is the static build's (`scripts/sw.ts`) with `shell: false`.
- The static build's worker is unchanged, except that it checks `/models/` before navigations, which behaves the same.

**Why:** the server build registered no worker, because its precache list came from the static export and signed-in pages must never come from a cache. So on the live site, the manifest's share target had nothing on the device to answer it: Android would POST the shared photos to our server, and `/share` never got them. The production image's browser tests (`mobile.spec.ts`) failed on main for that reason. They pass with this worker (224 passed against the server build, through the stand-in Access).

Updates [2026-10-01-mobile-polish-m8.md](2026-10-01-mobile-polish-m8.md): the share target works in both builds.

**Reverse:** delete `src/app/sw.js/route.server.ts` and put the `ETB_TARGET === 'server'` check back in `ServiceWorker.tsx`. Also take `share_target` out of the server build's manifest, or shared files go to the server.
