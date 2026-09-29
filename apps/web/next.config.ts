import type { NextConfig } from 'next';

import { loadEnv, webEnvSchema } from '@etb/core/env';

// Fail fast, before Next starts compiling, if the env is wrong.
const env = loadEnv('web', webEnvSchema);

const nextConfig: NextConfig = {
  // Until M5 the site is a static export: served locally by `pnpm preview`,
  // and by Cloudflare Pages after Go public (docs/01-architecture.md → Hosting).
  // No server features, no next/image optimisation.
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
  // Internal packages ship TypeScript source.
  transpilePackages: ['@etb/core'],
  // Inlined at build time into server and client code; read them through
  // src/lib/urls.ts, never spell out a host.
  env: {
    SITE_URL: env.SITE_URL,
    MODELS_BASE_URL: env.MODELS_BASE_URL,
  },
};

export default nextConfig;
