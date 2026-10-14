# 2026-10-14 · The web image builds without shared variables; storage's CSP origin is read at start

**Decision:**
- `apps/web/Dockerfile` builds the server with a build-only placeholder for every required server variable that Railway takes from shared variables: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `SMTP_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.
- Only `SITE_URL`, `MODELS_BASE_URL` and the optional analytics pair stay build arguments. They are the only values the pages inline, and Railway always passes the first two because they are literals in `.railway/railway.ts`.
- Storage's origin in the CSP's `connect-src` (`S3_PUBLIC_ENDPOINT`, else `S3_ENDPOINT`) is no longer inlined by `next.config.ts`. `src/lib/csp.ts` → `storageOrigin()` reads it from the environment the server starts with.
- CI's "Production web image" job builds the Dockerfile the way Railway does before any shared variable is set: the repo root as context and `SITE_URL` as the only build argument. Its e2e run then checks that the pages name the storage origin the container started with.
- `src/dockerfile.test.ts` fails if the build would need a variable that is neither a placeholder nor passed by Railway. It also fails if a placeholder shadows a build argument or appears in `next.config.ts`.

**Why:**
- Railway's web build failed with "S3_ENDPOINT: required but not set". The Dockerfile declared `ARG S3_ENDPOINT`, and Railway fills it from the shared variable, which wasn't set yet. CI never caught this because it passed every value by hand.
- A plain placeholder on the RUN line would have fixed the build but broken uploads. `next.config.ts` inlined storage's origin at build time, so every page's CSP would have allowed `http://127.0.0.1:1` instead of R2, and browsers would have refused every upload. Reading it at start keeps the image independent of the storage settings, as it already was for the secrets.

**Reverse:** put `ARG S3_ENDPOINT` (and `S3_PUBLIC_ENDPOINT`) back in the Dockerfile, restore `STORAGE_ORIGIN` in `next.config.ts`'s `env`, and read `process.env.STORAGE_ORIGIN` in `src/proxy.server.ts`. The build would then need the shared variables set before it runs.
