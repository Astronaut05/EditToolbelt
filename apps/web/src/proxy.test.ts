import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

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
