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

  it('keeps files shared from another app for /share, and nothing older', async () => {
    const stored = new Map<string, Response>();
    stored.set('/share/file/0', new Response('old'));
    const cache = {
      keys: () => Promise.resolve([...stored.keys()]),
      delete: (key: string) => Promise.resolve(stored.delete(key)),
      put: (key: string, response: Response) => {
        stored.set(key, response);
        return Promise.resolve();
      },
    };
    const handlers: Record<string, (event: unknown) => void> = {};
    const sandbox = {
      self: {
        location: { origin: 'https://etb.test' },
        addEventListener: (type: string, handler: (event: unknown) => void) => {
          handlers[type] = handler;
        },
      },
      caches: { open: () => Promise.resolve(cache) },
      Response,
      URL,
      Date,
      String,
      Promise,
    };
    new Script(serviceWorker({ precache: [], modelsOrigin: null })).runInNewContext(sandbox);
    const form = new FormData();
    form.append('files', new File(['jpg'], 'Holiday 1.jpg', { type: 'image/jpeg' }));
    form.append('files', new File(['mp4'], 'clip.mp4', { type: 'video/mp4' }));
    let answer: Promise<Response> | undefined;
    handlers.fetch?.({
      request: new Request('https://etb.test/share', { method: 'POST', body: form }),
      respondWith: (response: Promise<Response>) => {
        answer = response;
      },
    });
    const response = await answer;
    expect(response?.status).toBe(303);
    expect(response?.headers.get('Location')).toBe('https://etb.test/share?files=2');
    expect([...stored.keys()]).toEqual(['/share/file/0', '/share/file/1']);
    const first = stored.get('/share/file/0');
    expect(first?.headers.get('X-File-Name')).toBe('Holiday%201.jpg');
    expect(first?.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await first?.text()).toBe('jpg');
  });
});
