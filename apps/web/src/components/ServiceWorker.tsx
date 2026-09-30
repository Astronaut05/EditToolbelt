'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js (written by scripts/postbuild.ts) in the static production
 * build, after the page has loaded so it never competes with first paint. The
 * server build has no worker: its precache list comes from the static
 * export, and signed-in pages must never be served from a cache.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      process.env.ETB_TARGET === 'server' ||
      !('serviceWorker' in navigator)
    ) {
      return;
    }
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // No worker (dev server, private mode): the site works without it.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
