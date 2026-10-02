/**
 * The Content Security Policy, one definition for both builds (docs/11 → Web app).
 *
 * - Static export: every inline script's sha256 (scripts/csp.ts writes it into
 *   each page as a <meta> tag).
 * - Server build, pages rendered per request (/account, /sign-in, /admin): a
 *   fresh nonce per response, set by the proxy, which Next puts on its scripts.
 * - Server build, prerendered pages: 'unsafe-inline' for scripts, the fallback
 *   docs/11 allows (we render no user HTML). Local stack only until M5.
 * - /credits/buy adds Paddle's script, style and frame origins for its
 *   overlay checkout (src/lib/paddle-js.ts); no other page has them.
 */
export interface CspOptions {
  /** sha256 sources of the page's inline scripts. */
  hashes?: string[];
  /** A per-response nonce. */
  nonce?: string;
  /** Allow inline scripts (prerendered pages in the server build). */
  inline?: boolean;
  /** 'wasm-unsafe-eval': pages that run WebAssembly. */
  wasm?: boolean;
  /** 'unsafe-eval' for React's development build (next dev only). */
  dev?: boolean;
  /** Extra origins for connect-src (models host, analytics), e.g. "https://models.example.com". */
  connect?: readonly string[];
  /** Third-party script, style and frame origins: Paddle's overlay on /credits/buy only. */
  scripts?: readonly string[];
  styles?: readonly string[];
  frames?: readonly string[];
  /** Add frame-ancestors, which only works as a header, not in a <meta> tag. */
  header?: boolean;
}

export function buildCsp(options: CspOptions = {}): string {
  const script = ["'self'"];
  if (options.nonce) script.push(`'nonce-${options.nonce}'`, "'strict-dynamic'");
  if (options.inline) script.push("'unsafe-inline'");
  if (options.wasm) script.push("'wasm-unsafe-eval'");
  if (options.dev) script.push("'unsafe-eval'");
  script.push(...(options.hashes ?? []), ...(options.scripts ?? []));
  const connect = ["'self'", ...(options.connect ?? [])].join(' ');
  const frames = options.frames?.length ? options.frames.join(' ') : "'none'";
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    // React sets style attributes (before/after split, progress); we render no user HTML.
    ["style-src 'self' 'unsafe-inline'", ...(options.styles ?? [])].join(' '),
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `frame-src ${frames}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(options.header ? ["frame-ancestors 'none'"] : []),
  ].join('; ');
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
