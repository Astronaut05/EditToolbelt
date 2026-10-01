# Production image for apps/web: the Next.js server build (ETB_TARGET=server),
# every page, the API and the admin (docs/01-architecture.md → Hosting).
# Build context: the repo root. Railway builds it (.railway/railway.ts); the
# pre-deploy command migrates the database with this same image.
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    ETB_TARGET=server

RUN corepack enable

WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @etb/web... --filter @etb/db...

# Inlined into the pages at build time (next.config.ts), so they are build
# arguments; none of them is a secret. Railway passes the service's variables
# of these names.
ARG SITE_URL
ARG S3_ENDPOINT
ARG MODELS_BASE_URL=/models
ARG ANALYTICS_URL
ARG ANALYTICS_WEBSITE_ID

# The build checks the whole server env (next.config.ts), so the secrets get
# build-only placeholders here. They are never inlined anywhere: the real ones
# are read when the server starts.
RUN APP_ENV=production \
    DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    BETTER_AUTH_SECRET=build-only-placeholder-never-used-at-runtime \
    SMTP_URL=smtp://127.0.0.1:1 \
    S3_BUCKET=build-only \
    S3_ACCESS_KEY_ID=build-only \
    S3_SECRET_ACCESS_KEY=build-only \
    pnpm --filter @etb/web build:server \
    && chown -R node:node apps/web/.next-server

USER node
EXPOSE 8080
# APP_VERSION is the deployed commit (Railway names it); /healthz reports it.
CMD ["sh", "-c", "export APP_VERSION=\"${APP_VERSION:-${RAILWAY_GIT_COMMIT_SHA:-dev}}\"; cd apps/web && exec ./node_modules/.bin/next start --hostname :: --port \"${PORT:-8080}\""]
