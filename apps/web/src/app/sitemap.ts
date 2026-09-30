import type { MetadataRoute } from 'next';

import { categories, conversionPath, isAvailable, livePairs, toolPath, tools } from '@etb/registry';

import { loadToolFlags } from '../lib/flags';
import { absoluteUrl } from '../lib/urls';

export const dynamic = 'force-static';
// The server build re-renders with the tool status in the database; the static export ignores this.
export const revalidate = 30;

const LEGAL = ['/privacy', '/terms', '/refunds', '/cookies', '/licenses', '/contact'];

/**
 * Only pages with a working tool, plus hubs and legal pages (docs/09): `soon`
 * placeholders are noindex and stay out, and so are pairs without a page.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await loadToolFlags();
  const lastModified = new Date();
  const paths = [
    '/',
    ...categories.map((category) => `/${category.slug}`),
    ...tools.filter(isAvailable).map(toolPath),
    ...livePairs().map(conversionPath),
    ...LEGAL,
  ];
  return paths.map((path) => ({ url: absoluteUrl(path), lastModified }));
}
