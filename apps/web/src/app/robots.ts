import type { MetadataRoute } from 'next';

import { absoluteUrl } from '../lib/urls';

export const dynamic = 'force-static';

// docs/09 → Technical SEO: allow all except the private areas.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/account'] },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
