/**
 * Files shared from another app (Android's share sheet), as the service worker
 * keeps them for /share (scripts/sw.ts): in the `etb-shared` cache on this
 * device, each with the time it came. /share reads them and deletes them at
 * once. One that /share never reads (the share was made offline, or a sign-in
 * was left halfway) goes after an hour, the next time any page of the site
 * opens: nothing shared stays on the device.
 */
export const SHARED = 'etb-shared';
export const SHARED_MAX_AGE_MS = 60 * 60 * 1000;

/** Whether a kept file is past its hour, or doesn't say when it came. */
export function isStale(response: Response, now: number): boolean {
  const at = Number(response.headers.get('X-Shared-At'));
  return !Number.isFinite(at) || at <= 0 || now - at > SHARED_MAX_AGE_MS;
}

/** Deletes the shared files past their hour; makes no cache when there's none. */
export async function expireShared(now = Date.now()): Promise<void> {
  if (typeof caches === 'undefined' || !(await caches.has(SHARED))) return;
  const cache = await caches.open(SHARED);
  for (const key of await cache.keys()) {
    const response = await cache.match(key);
    if (!response || isStale(response, now)) await cache.delete(key);
  }
}
