import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseEnv, webServerEnvSchema } from '@etb/core/env';

/**
 * The production image's build (apps/web/Dockerfile) as Railway runs it: the
 * build checks the whole server env (next.config.ts), but Railway passes only
 * the ARGs its service sets, and the ones it takes from shared variables may
 * not be set yet. So everything the build requires must be a literal in
 * .railway/railway.ts or a build-only placeholder on the RUN line.
 */
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const railway = readFileSync(new URL('../../../.railway/railway.ts', import.meta.url), 'utf8');
const nextConfig = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');

/** `ARG NAME` and `ARG NAME=default`. */
const args = new Map(
  [...dockerfile.matchAll(/^ARG (\w+)(?:=(\S*))?$/gm)].map((match) => [match[1] ?? '', match[2]]),
);

/** The `NAME=value` pairs on the RUN line that builds the server, before the command. */
const placeholders = (() => {
  const run = /^RUN (APP_ENV=[\s\S]*?)pnpm --filter @etb\/web build:server/m.exec(dockerfile)?.[1];
  if (!run) throw new Error('apps/web/Dockerfile: no RUN line that builds the server');
  return Object.fromEntries(
    [...run.matchAll(/(\w+)=(\S+)/g)].map((match) => [match[1] ?? '', match[2] ?? '']),
  );
})();

describe('apps/web/Dockerfile', () => {
  it('builds with nothing from shared variables, as Railway does before they are set', () => {
    // SITE_URL is a literal in .railway/railway.ts (the site's origin), so Railway always passes it.
    expect(railway).toMatch(/^\s+SITE_URL: site\.origin,$/m);
    const env: Record<string, string> = { SITE_URL: 'https://site.example' };
    for (const [name, fallback] of args) if (fallback) env[name] = fallback;
    const result = parseEnv(webServerEnvSchema, { ...env, ...placeholders });
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('never lets a placeholder replace a value Railway passes', () => {
    for (const name of Object.keys(placeholders)) {
      expect(args.has(name), `${name} is an ARG and a placeholder`).toBe(false);
    }
  });

  it('never bakes a placeholder into the pages', () => {
    // next.config.ts inlines its `env` at build time; placeholders must stay out of it.
    for (const name of Object.keys(placeholders).filter((key) => key !== 'APP_ENV')) {
      expect(nextConfig, name).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});
