'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js (written by scripts/postbuild.ts) in production builds,
 * after the page has loaded so it never competes with first paint.
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
