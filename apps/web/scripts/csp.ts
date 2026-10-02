/**
 * Per-page Content Security Policy for the static export (docs/11 → CSP).
 *
 * Public pages stay static, so there are no nonces: every inline <script> in
 * a built HTML file is hashed and allowed by its sha256, Next's own script
 * files load from 'self' (with SRI integrity attributes), and nothing else
 * runs. The policy goes into the page as a <meta http-equiv> tag, right after
 * the charset, before any script. Every page gets 'wasm-unsafe-eval': a
 * client-side navigation keeps the policy of the page it started on, and some
 * tools compile WebAssembly under it (docs/decisions/2026-10-02-server-build-csp.md).
 */
import { createHash } from 'node:crypto';

import { buildCsp } from '../src/lib/csp.ts';

export { originOf } from '../src/lib/csp.ts';

const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi;

export interface CspOptions {
  /** Extra origins for connect-src (models host, analytics), e.g. "https://models.example.com". */
  connect?: string[];
}

export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const [, attrs = '', body = ''] = match;
    // JSON-LD and other data blocks don't execute; CSP doesn't apply to them.
    if (/\btype="(?!text\/javascript|module)[^"]*"/i.test(attrs)) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return [...hashes];
}

/** Adds the CSP meta tag to one HTML document. */
export function injectCsp(html: string, options: CspOptions = {}): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp({ hashes: inlineScriptHashes(html), wasm: true, connect: options.connect ?? [] })}"/>`;
  const charset = /<meta charSet="utf-8"\/>/i;
  if (charset.test(html)) return html.replace(charset, (tag) => tag + meta);
  if (html.includes('<head>')) return html.replace('<head>', `<head>${meta}`);
  throw new Error('No <head> to put the CSP in');
}
