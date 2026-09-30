/**
 * Per-page Content Security Policy for the static export (docs/11 → CSP).
 *
 * Public pages stay static, so there are no nonces: every inline <script> in
 * a built HTML file is hashed and allowed by its sha256, Next's own script
 * files load from 'self' (with SRI integrity attributes), and nothing else
 * runs. The policy goes into the page as a <meta http-equiv> tag, right after
 * the charset, before any script. Pages that load WebAssembly carry
 * <meta name="etb-csp" content="wasm"> (set from the registry) and get
 * 'wasm-unsafe-eval'; the marker is removed from the output.
 */
import { createHash } from 'node:crypto';

import { buildCsp } from '../src/lib/csp.ts';

export { originOf } from '../src/lib/csp.ts';

const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const FLAGS = /<meta name="etb-csp" content="([^"]*)"\/?>/;

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

/** Adds the CSP meta tag to one HTML document and drops the etb-csp marker. */
export function injectCsp(html: string, options: CspOptions = {}): string {
  const flags = FLAGS.exec(html)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
  const cleaned = html.replace(FLAGS, '');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp({ hashes: inlineScriptHashes(cleaned), wasm: flags.includes('wasm'), connect: options.connect ?? [] })}"/>`;
  const charset = /<meta charSet="utf-8"\/>/i;
  if (charset.test(cleaned)) return cleaned.replace(charset, (tag) => tag + meta);
  if (cleaned.includes('<head>')) return cleaned.replace('<head>', `<head>${meta}`);
  throw new Error('No <head> to put the CSP in');
}
