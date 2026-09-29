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

export function buildCsp(hashes: string[], flags: string[], options: CspOptions = {}): string {
  const wasm = flags.includes('wasm') ? " 'wasm-unsafe-eval'" : '';
  const connect = ["'self'", ...(options.connect ?? [])].join(' ');
  return [
    "default-src 'self'",
    `script-src 'self'${wasm}${hashes.length ? ` ${hashes.join(' ')}` : ''}`,
    // React sets style attributes (before/after split, progress); we render no user HTML.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** Adds the CSP meta tag to one HTML document and drops the etb-csp marker. */
export function injectCsp(html: string, options: CspOptions = {}): string {
  const flags = FLAGS.exec(html)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
  const cleaned = html.replace(FLAGS, '');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(inlineScriptHashes(cleaned), flags, options)}"/>`;
  const charset = /<meta charSet="utf-8"\/>/i;
  if (charset.test(cleaned)) return cleaned.replace(charset, (tag) => tag + meta);
  if (cleaned.includes('<head>')) return cleaned.replace('<head>', `<head>${meta}`);
  throw new Error('No <head> to put the CSP in');
}

/** The origin of an absolute URL, or null for a path on our own origin. */
export function originOf(url: string | undefined): string | null {
  if (!url || url.startsWith('/')) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
