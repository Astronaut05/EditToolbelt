import { describe, expect, it } from 'vitest';

import { headersForPath, type HeaderRule } from './headers';

describe('headersForPath', () => {
  const rules: HeaderRule[] = [
    {
      path: '/*',
      headers: [
        ['X-Frame-Options', 'DENY'],
        ['Content-Security-Policy', "frame-ancestors 'none'"],
      ],
    },
    { path: '/_next/static/*', headers: [['Cache-Control', 'immutable']] },
    { path: '/video-tool', headers: [['Cross-Origin-Embedder-Policy', 'require-corp']] },
  ];

  it('applies every matching rule, as _headers does, and leaves the CSP to the proxy', () => {
    expect(headersForPath('/', rules)).toEqual([['X-Frame-Options', 'DENY']]);
    expect(headersForPath('/_next/static/chunks/a.js', rules)).toEqual([
      ['X-Frame-Options', 'DENY'],
      ['Cache-Control', 'immutable'],
    ]);
    expect(headersForPath('/video-tool', rules)).toContainEqual([
      'Cross-Origin-Embedder-Policy',
      'require-corp',
    ]);
    expect(headersForPath('/video-tool/more', rules)).toEqual([['X-Frame-Options', 'DENY']]);
  });

  it("matches the site's own rules: security headers everywhere", () => {
    const names = headersForPath('/api/v1/tools').map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining(['X-Content-Type-Options', 'Strict-Transport-Security']),
    );
    expect(names).not.toContain('Content-Security-Policy');
  });
});
