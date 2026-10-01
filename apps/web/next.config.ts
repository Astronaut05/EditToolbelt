import type { NextConfig } from 'next';

import { loadEnv, webEnvSchema, webServerEnvSchema } from '@etb/core/env';

/**
 * Two builds of one app (docs/DECISIONS.md → "The server build"):
 * - static (default): the public site, a static export served by `pnpm preview`
 *   and by Cloudflare Pages after Go public. No accounts, no API.
 * - server (ETB_TARGET=server): the same pages plus accounts, the admin and
 *   the API, run by Next's server. The local stack from M3, production from M5.
 * Route files named `*.server.tsx|ts` exist only in the server build, and
 * `*.static.tsx|ts` only in the static one (e.g. the two /sign-in pages).
 */
const target = process.env.ETB_TARGET === 'server' ? 'server' : 'static';

// Fail fast, before Next starts compiling, if the env is wrong.
const server = target === 'server' ? loadEnv('web (server)', webServerEnvSchema) : null;
const env = server ?? loadEnv('web', webEnvSchema);

// Local-only design workshop (component gallery and the design screens with
// fixture data): files named `*.workshop.tsx` are routes only when
// ETB_WORKSHOP=1, so they never reach a production build.
const workshop = process.env.ETB_WORKSHOP === '1';

const nextConfig: NextConfig = {
  pageExtensions: [
    `${target}.tsx`,
    `${target}.ts`,
    ...(workshop ? ['workshop.tsx'] : []),
    'tsx',
    'ts',
  ],
  // The static build is an export: no server features, no next/image optimisation.
  ...(target === 'static' ? { output: 'export' as const } : { distDir: '.next-server' }),
  images: { unoptimized: true },
  // `pnpm typecheck` checks every file, server routes included. The server
  // build skips Next's own pass, which would read the static build's
  // generated route types (.next/types) and trip over the other build's pages.
  ...(target === 'server' && { typescript: { ignoreBuildErrors: true } }),
  reactStrictMode: true,
  // Internal packages ship TypeScript source.
  transpilePackages: [
    '@etb/api-client',
    '@etb/config',
    '@etb/core',
    '@etb/db',
    '@etb/engines',
    '@etb/registry',
    '@etb/ui',
  ],
  serverExternalPackages: ['pg', 'nodemailer'],
  experimental: {
    optimizePackageImports: ['@etb/ui', 'lucide-react'],
    sri: { algorithm: 'sha256' },
  },
  // Inlined at build time into server and client code; read them through
  // src/lib/urls.ts, never spell out a host.
  env: {
    ETB_TARGET: target,
    SITE_URL: env.SITE_URL,
    MODELS_BASE_URL: env.MODELS_BASE_URL,
    ANALYTICS_URL: env.ANALYTICS_URL ?? '',
    ANALYTICS_WEBSITE_ID: env.ANALYTICS_WEBSITE_ID ?? '',
    // Where browsers PUT upload parts and GET results (the CSP's connect-src).
    STORAGE_ORIGIN: server ? new URL(server.S3_PUBLIC_ENDPOINT ?? server.S3_ENDPOINT).origin : '',
  },
};

export default nextConfig;
