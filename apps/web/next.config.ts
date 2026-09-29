import type { NextConfig } from 'next';

import { loadEnv, webEnvSchema } from '@etb/core/env';

// Fail fast, before Next starts compiling, if the env is wrong.
loadEnv('web', webEnvSchema);

const nextConfig: NextConfig = {
  // Until M5 the public site is a static export on Cloudflare Pages
  // (docs/01-architecture.md → Hosting). No server features, no next/image optimisation.
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
  // Internal packages ship TypeScript source.
  transpilePackages: ['@etb/core'],
};

export default nextConfig;
