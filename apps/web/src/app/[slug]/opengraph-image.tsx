import { categories, findToolBySlug, getCategory, isAvailable, runsInBrowser } from '@etb/registry';

import { ogImage, OG_SIZE } from '../../lib/og';

export const dynamic = 'force-static';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'EditToolbelt';

// Same static params as the page: one image per hub and tool.
export { generateStaticParams } from './page';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = categories.find((candidate) => candidate.slug === slug);
  if (category) {
    return ogImage({
      label: 'EditToolbelt',
      title: category.title,
      lead: category.lead,
      status: `${category.name} tools`,
    });
  }
  const tool = findToolBySlug(slug);
  if (!tool) throw new Error(`No tool for ${slug}`);
  const status = !isAvailable(tool)
    ? 'Coming soon'
    : runsInBrowser(tool)
      ? 'Runs in your browser'
      : 'Processed on our servers';
  return ogImage({
    label: `${getCategory(tool.category).name} / ${tool.name}`,
    title: tool.seo.h1,
    lead: tool.tagline,
    status,
  });
}
