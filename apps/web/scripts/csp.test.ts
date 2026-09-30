import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildCsp } from '../src/lib/csp';
import { injectCsp, inlineScriptHashes, originOf } from './csp';

const sha = (body: string) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`;

const page = `<!DOCTYPE html><html><head><meta charSet="utf-8"/><meta name="etb-csp" content="wasm"/><script>a()</script><script src="/x.js" async=""></script></head><body><script type="application/ld+json">{"a":1}</script><script>b()</script></body></html>`;

describe('CSP', () => {
  it('hashes executable inline scripts only', () => {
    expect(inlineScriptHashes(page)).toEqual([sha('a()'), sha('b()')]);
  });

  it('puts the policy right after the charset and drops the marker', () => {
    const out = injectCsp(page);
    expect(out).toMatch(
      /^<!DOCTYPE html><html><head><meta charSet="utf-8"\/><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-/,
    );
    expect(out).not.toContain('etb-csp');
  });

  it('adds wasm-unsafe-eval only when asked, and extra connect origins', () => {
    const plain = buildCsp();
    expect(plain).toContain("script-src 'self';");
    expect(plain).not.toContain('wasm-unsafe-eval');
    expect(plain).toContain("frame-src 'none'");
    expect(plain).not.toContain('frame-ancestors');
    expect(buildCsp({ connect: ['https://models.example.com'] })).toContain(
      "connect-src 'self' https://models.example.com",
    );
  });

  it('uses a nonce with strict-dynamic on pages rendered per request', () => {
    const csp = buildCsp({ nonce: 'abc123', header: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(buildCsp({ inline: true, wasm: true })).toContain(
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';",
    );
  });

  it('reads origins from absolute URLs only', () => {
    expect(originOf('/models')).toBeNull();
    expect(originOf(undefined)).toBeNull();
    expect(originOf('https://models.example.com/v1/')).toBe('https://models.example.com');
  });
});
