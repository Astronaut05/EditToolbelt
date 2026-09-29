import type { MetadataRoute } from 'next';

import {
  categories,
  conversionPath,
  conversions,
  isAvailable,
  toolPath,
  tools,
} from '@etb/registry';

import { absoluteUrl } from '../lib/urls';

export const dynamic = 'force-static';

const LEGAL = ['/privacy', '/terms', '/refunds', '/cookies', '/licenses', '/contact'];

/**
 * Only pages with a working tool, plus hubs and legal pages (docs/09): `soon`
 * placeholders are noindex and stay out. In M1 every tool is `soon`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const working = new Set(tools.filter(isAvailable).map((tool) => tool.id));
  const paths = [
    '/',
    ...categories.map((category) => `/${category.slug}`),
    ...tools.filter(isAvailable).map(toolPath),
    ...conversions.filter((pair) => working.has(pair.toolId)).map(conversionPath),
    ...LEGAL,
  ];
  return paths.map((path) => ({ url: absoluteUrl(path), lastModified }));
}
