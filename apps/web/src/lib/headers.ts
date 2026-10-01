/**
 * Response headers for the static site, written to `_headers` at build time
 * (Cloudflare Pages format; `pnpm preview` applies the same file). The page
 * CSP is not here: it needs each page's inline-script hashes, so
 * scripts/postbuild.ts writes it into every HTML file as a <meta> tag.
 * Header-only directives (frame-ancestors) are set here for every path.
 *
 * docs/11-security.md → Headers; docs/01 → Cross-origin isolation.
 */
import { ISOLATED_PATHS } from '@etb/registry';

export interface HeaderRule {
  path: string;
  headers: [string, string][];
}

export function headerRules(): HeaderRule[] {
  return [
    {
      path: '/*',
      headers: [
        ['X-Content-Type-Options', 'nosniff'],
        ['Referrer-Policy', 'strict-origin-when-cross-origin'],
        [
          'Permissions-Policy',
          'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
        ],
        ['Content-Security-Policy', "frame-ancestors 'none'"],
        ['X-Frame-Options', 'DENY'],
        // Ignored over plain http (local preview); HTTPS only after Go public. Preload later (docs/11).
        ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
      ],
    },
    {
      // Content-hashed by Next.js: cache forever.
      path: '/_next/static/*',
      headers: [['Cache-Control', 'public, max-age=31536000, immutable']],
    },
    {
      path: '/sw.js',
      headers: [['Cache-Control', 'no-cache']],
    },
    // Tools that need SharedArrayBuffer (multi-threaded ffmpeg.wasm). Every
    // link into them is a full page load (AppLink), so isolation applies.
    ...[...ISOLATED_PATHS].map((path) => ({
      path,
      headers: [
        ['Cross-Origin-Opener-Policy', 'same-origin'],
        ['Cross-Origin-Embedder-Policy', 'require-corp'],
      ] as [string, string][],
    })),
  ];
}

/**
 * The headers `headerRules()` sets on one path, as `pnpm preview` and
 * Cloudflare Pages apply `_headers`: every matching rule, in order (`*` is
 * any run of characters). The server build's proxy uses it; the CSP is left
 * to the proxy, which builds the page's own.
 */
export function headersForPath(pathname: string, rules = headerRules()): [string, string][] {
  const out = new Map<string, [string, string]>();
  for (const rule of rules) {
    const pattern = new RegExp(
      `^${rule.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    if (!pattern.test(pathname)) continue;
    for (const [name, value] of rule.headers) {
      if (name === 'Content-Security-Policy') continue;
      out.set(name.toLowerCase(), [name, value]);
    }
  }
  return [...out.values()];
}

export function renderHeaders(rules: HeaderRule[]): string {
  return rules
    .map((rule) =>
      [rule.path, ...rule.headers.map(([name, value]) => `  ${name}: ${value}`)].join('\n'),
    )
    .join('\n\n')
    .concat('\n');
}
