import { describe, expect, it } from 'vitest';

import { expireShared, isStale, SHARED, SHARED_MAX_AGE_MS } from './shared-files';

const kept = (at: string | null) =>
  new Response('x', { headers: at === null ? {} : { 'X-Shared-At': at } });

describe('shared files', () => {
  it('are stale past their hour, or when they don’t say when they came', () => {
    const now = 1_800_000_000_000;
    expect(isStale(kept(String(now - 60_000)), now)).toBe(false);
    expect(isStale(kept(String(now - SHARED_MAX_AGE_MS - 1)), now)).toBe(true);
    expect(isStale(kept(null), now)).toBe(true);
    expect(isStale(kept('soon'), now)).toBe(true);
  });

  it('go from the cache once stale, and no cache is made when there is none', async () => {
    const now = 1_800_000_000_000;
    const stored = new Map<string, Response>([
      ['/share/file/0', kept(String(now - 5_000))],
      ['/share/file/1', kept(String(now - 2 * SHARED_MAX_AGE_MS))],
    ]);
    const opened: string[] = [];
    let exists = true;
    globalThis.caches = {
      has: (name: string) => Promise.resolve(exists && name === SHARED),
      open: (name: string) => {
        opened.push(name);
        return Promise.resolve({
          keys: () => Promise.resolve([...stored.keys()]),
          match: (key: string) => Promise.resolve(stored.get(key)),
          delete: (key: string) => Promise.resolve(stored.delete(key)),
        });
      },
    } as unknown as CacheStorage;
    await expireShared(now);
    expect([...stored.keys()]).toEqual(['/share/file/0']);
    exists = false;
    await expireShared(now);
    expect(opened).toEqual([SHARED]);
  });
});
