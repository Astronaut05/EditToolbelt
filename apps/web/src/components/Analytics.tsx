'use client';

import { usePathname } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import { useEffect } from 'react';

import { analyticsEnabled, track, trackPageview } from '../lib/analytics';

/**
 * Page views on every route change, and Web Vitals (docs/10 → real-user
 * metrics). Personal pages (/admin, /account…) send neither: lib/analytics.ts
 * drops everything there.
 */
export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (analyticsEnabled) trackPageview();
  }, [pathname]);

  useReportWebVitals((metric: { name: string; rating: string }) => {
    if (!analyticsEnabled || !['LCP', 'INP', 'CLS', 'FCP', 'TTFB'].includes(metric.name)) return;
    track('web_vital', { name: metric.name, rating: metric.rating, page: location.pathname });
  });

  return null;
}
