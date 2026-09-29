import type { NextConfig } from 'next';

import { loadEnv, webEnvSchema } from '@etb/core/env';

// Fail fast, before Next starts compiling, if the env is wrong.
const env = loadEnv('web', webEnvSchema);

// Local-only design workshop (component gallery and the design screens with
// fixture data): files named `*.workshop.tsx` are routes only when
// ETB_WORKSHOP=1, so they never reach a production build.
const workshop = process.env.ETB_WORKSHOP === '1';

const nextConfig: NextConfig = {
  pageExtensions: workshop ? ['workshop.tsx', 'tsx', 'ts'] : ['tsx', 'ts'],
  // Until M5 the site is a static export: served locally by `pnpm preview`,
  // and by Cloudflare Pages after Go public (docs/01-architecture.md → Hosting).
  // No server features, no next/image optimisation.
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
  // Internal packages ship TypeScript source.
  transpilePackages: ['@etb/core', '@etb/engines', '@etb/registry', '@etb/ui'],
  experimental: {
    optimizePackageImports: ['@etb/ui', 'lucide-react'],
    sri: { algorithm: 'sha256' },
  },
  // Inlined at build time into server and client code; read them through
  // src/lib/urls.ts, never spell out a host.
  env: {
    SITE_URL: env.SITE_URL,
    MODELS_BASE_URL: env.MODELS_BASE_URL,
    ANALYTICS_URL: env.ANALYTICS_URL ?? '',
    ANALYTICS_WEBSITE_ID: env.ANALYTICS_WEBSITE_ID ?? '',
  },
};

export default nextConfig;
