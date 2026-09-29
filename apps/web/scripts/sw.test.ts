import { Script } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { assetsIn, serviceWorker } from './sw';

describe('service worker', () => {
  it('finds hashed static assets in a page', () => {
    const html =
      '<link rel="stylesheet" href="/_next/static/chunks/a.css"/><link rel="preload" href="/_next/static/media/f.woff2" as="font"/><script src="/_next/static/chunks/b.js" async=""></script><script src="/_next/static/chunks/b.js"></script><a href="/photo">x</a>';
    expect(assetsIn(html)).toEqual([
      '/_next/static/chunks/a.css',
      '/_next/static/media/f.woff2',
      '/_next/static/chunks/b.js',
    ]);
  });

  it('versions the worker by its precache list', () => {
    const a = serviceWorker({ precache: ['/', '/a.js'], modelsOrigin: null });
    const b = serviceWorker({ precache: ['/a.js', '/'], modelsOrigin: null });
    const c = serviceWorker({ precache: ['/', '/b.js'], modelsOrigin: null });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain('const PRECACHE = ["/","/a.js"];');
    expect(serviceWorker({ precache: [], modelsOrigin: 'https://models.example.com' })).toContain(
      'const MODELS_ORIGIN = "https://models.example.com";',
    );
  });

  it('is valid JavaScript', () => {
    const source = serviceWorker({ precache: ['/'], modelsOrigin: null });
    // Compiles without running.
    expect(() => new Script(source)).not.toThrow();
  });
});
