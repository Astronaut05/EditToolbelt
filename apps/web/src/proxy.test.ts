import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import proxy from './proxy.server';

/** The script-src directive and caching the proxy gives one path in the server build. */
async function pageCsp(path: string): Promise<{ script: string; cache: string | null }> {
  const response = await proxy(new NextRequest(`http://localhost:3000${path}`));
  const csp = response.headers.get('content-security-policy') ?? '';
  expect(csp, path).toContain("frame-ancestors 'none'");
  expect(csp, path).toContain("object-src 'none'");
  return {
    script: csp.split('; ').find((part) => part.startsWith('script-src ')) ?? '',
    cache: response.headers.get('cache-control'),
  };
}

// docs/decisions/2026-10-02-server-build-csp.md
describe('the server build’s CSP per page', () => {
  it('gives every public page inline scripts and WebAssembly, cacheable', async () => {
    for (const path of [
      '/image-converter', // a tool that compiles WebAssembly
      '/convert/png-to-jpg', // its pair page
      '/timecode-calculator', // a calculator: none of its own…
      '/', // …nor home, a hub or a legal page, but a client-side navigation
      '/photo', // from any of them keeps their policy, and Extract Audio's
      '/privacy', // MP3 encoder compiles under it (e2e/security.spec.ts)
      '/no-such-page',
    ]) {
      const { script, cache } = await pageCsp(path);
      expect(script, path).toBe("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
      expect(cache, path).toBeNull();
    }
  });

  it('gives personal pages a nonce: no inline scripts, no WebAssembly, no caching', async () => {
    for (const path of [
      '/admin',
      '/admin/users/0199a0d4-7c2e-7000-8000-000000000000',
      '/account',
      '/sign-in',
      '/connect',
      '/credits/buy',
    ]) {
      const { script, cache } = await pageCsp(path);
      expect(script, path).toMatch(
        /^script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic' 'sha256-[A-Za-z0-9+/=]+'$/,
      );
      expect(cache, path).toBe('private, no-store');
    }
  });

  it('gives each request its own nonce', async () => {
    const [first, second] = await Promise.all([pageCsp('/account'), pageCsp('/account')]);
    expect(first.script).not.toBe(second.script);
  });

  it('sets no page CSP on scripts, workers and the API', async () => {
    for (const path of ['/_next/static/chunks/a.js', '/api/v1/tools', '/sw.js']) {
      const response = await proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(response.headers.get('content-security-policy'), path).toBeNull();
    }
  });
});

/**
 * The proxy reads the site's mode, the Access settings and the origin lock
 * once, when it loads: each case loads a fresh copy under its own env.
 */
async function proxyWith(env: Record<string, string>): Promise<typeof proxy> {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  try {
    return (await import('./proxy.server')).default;
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}

const statusOf = async (run: typeof proxy, path: string, headers?: Record<string, string>) =>
  (await run(new NextRequest(`http://localhost:3000${path}`, { headers }))).status;

// docs/decisions/2026-11-12-go-public.md
describe('who the proxy lets in', () => {
  const ACCESS = {
    CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.example',
    CF_ACCESS_AUD: 'aud-tag',
  };

  it('a public site answers anyone, and keeps /admin behind Access when Access is set up', async () => {
    const run = await proxyWith({ APP_ENV: 'production', ...ACCESS });
    for (const path of ['/', '/photo', '/api/v1/tools', '/readyz/worker', '/healthz', '/readyz']) {
      expect(await statusOf(run, path), path).toBe(200);
    }
    for (const path of ['/admin', '/admin/users', '/%61dmin', '/Admin/tools']) {
      expect(await statusOf(run, path), path).toBe(403);
    }
    // A token that isn't one is refused too.
    expect(await statusOf(run, '/admin', { 'cf-access-jwt-assertion': 'a.b.c' })).toBe(403);
  });

  it('a public site without Access leaves /admin to its own sign-in', async () => {
    const run = await proxyWith({ APP_ENV: 'production' });
    expect(await statusOf(run, '/')).toBe(200);
    expect(await statusOf(run, '/admin')).toBe(200);
  });

  it('a private site refuses every page without a token, and answers 503 until Access is set up', async () => {
    const closed = await proxyWith({ APP_ENV: 'production', SITE_ACCESS: 'private', ...ACCESS });
    for (const path of ['/', '/photo', '/api/v1/tools', '/readyz/worker', '/admin']) {
      expect(await statusOf(closed, path), path).toBe(403);
    }
    for (const path of ['/healthz', '/readyz', '/api/webhooks/paddle']) {
      expect(await statusOf(closed, path), path).toBe(200);
    }
    const unset = await proxyWith({ APP_ENV: 'production', SITE_ACCESS: 'private' });
    expect(await statusOf(unset, '/')).toBe(503);
    expect(await statusOf(unset, '/healthz')).toBe(200);
    // Off production (the local stack) a private site with no Access is simply open.
    const local = await proxyWith({ SITE_ACCESS: 'private' });
    expect(await statusOf(local, '/')).toBe(200);
  });

  it('a team domain that is not a host does not take the server down', async () => {
    const run = await proxyWith({
      APP_ENV: 'production',
      CF_ACCESS_TEAM_DOMAIN: 'not a host',
      CF_ACCESS_AUD: 'aud-tag',
    });
    expect(await statusOf(run, '/healthz')).toBe(200);
    expect(await statusOf(run, '/')).toBe(200);
  });

  it('with the origin lock on, only requests that came through Cloudflare get in', async () => {
    const secret = 'origin-secret-of-at-least-32-characters';
    const run = await proxyWith({ APP_ENV: 'production', ORIGIN_AUTH_SECRET: secret });
    for (const path of ['/', '/api/v1/tools', '/api/webhooks/paddle', '/readyz/worker']) {
      expect(await statusOf(run, path), path).toBe(403);
      expect(await statusOf(run, path, { 'x-origin-auth': 'wrong' }), path).toBe(403);
      expect(await statusOf(run, path, { 'x-origin-auth': secret }), path).toBe(200);
    }
    // Railway's health check reaches the service directly.
    expect(await statusOf(run, '/healthz')).toBe(200);
    expect(await statusOf(run, '/readyz')).toBe(200);
  });
});
