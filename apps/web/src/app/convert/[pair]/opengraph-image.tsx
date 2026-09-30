import { conversions, conversionTitle, getCategory, getTool, PAIR_COPY } from '@etb/registry';

import { ogImage, OG_SIZE } from '../../../lib/og';

export const dynamic = 'force-static';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'EditToolbelt';

// Same static params as the page: one image per pair page.
export { generateStaticParams } from './page';

export default async function Image({ params }: { params: Promise<{ pair: string }> }) {
  const { pair: slug } = await params;
  const pair = conversions.find((candidate) => candidate.slug === slug);
  const copy = PAIR_COPY[slug];
  if (!pair || !copy) throw new Error(`No pair for ${slug}`);
  const tool = getTool(pair.toolId);
  return ogImage({
    label: `${getCategory(tool.category).name} / ${conversionTitle(pair)}`,
    title: copy.h1,
    lead: copy.tagline,
    status: 'Runs in your browser',
  });
}
