'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js in production builds, after the page has loaded so it
 * never competes with first paint. The static build's worker (written by
 * scripts/postbuild.ts) precaches the app shell. The server build's
 * (src/app/sw.js/route.server.ts) takes Android's share target and caches
 * models only: signed-in pages must never be served from a cache.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
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
