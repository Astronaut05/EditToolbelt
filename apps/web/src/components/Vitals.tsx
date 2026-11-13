'use client';

import { useReportWebVitals } from 'next/web-vitals';

import { track } from '../lib/analytics';

/**
 * Web Vitals to the collector (docs/10 → real-user metrics). A file of its
 * own, with the measuring code it brings (about 2 KB): Analytics fetches it
 * only where analytics is on, after the page.
 */
export function Vitals() {
  useReportWebVitals((metric: { name: string; rating: string }) => {
    if (!['LCP', 'INP', 'CLS', 'FCP', 'TTFB'].includes(metric.name)) return;
    track('web_vital', { name: metric.name, rating: metric.rating, page: location.pathname });
  });
  return null;
}
