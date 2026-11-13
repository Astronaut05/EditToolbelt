'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';

import { analyticsEnabled, trackPageview } from '../lib/analytics';

/**
 * Page views on every route change, and Web Vitals (docs/10 → real-user
 * metrics). Personal pages (/admin, /account…) send neither: lib/analytics.ts
 * drops everything there.
 */
export function Analytics() {
  const pathname = usePathname();
  // The measuring code is fetched only where analytics is on, and after the
  // page: with analytics off every page carried it for nothing. Nothing is
  // missed by starting late, the browser keeps what it measured before.
  const [Vitals, setVitals] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (!analyticsEnabled) return;
    void import('./Vitals').then((loaded) => {
      setVitals(() => loaded.Vitals);
    });
  }, []);

  useEffect(() => {
    if (analyticsEnabled) trackPageview();
  }, [pathname]);

  return Vitals && <Vitals />;
}
