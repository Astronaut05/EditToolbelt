import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  categoryPath,
  conversionPath,
  conversions,
  conversionTitle,
  getCategory,
  getTool,
  isAvailable,
  livePairs,
  PAIR_COPY,
  toolPath,
  toolsInCategory,
} from '@etb/registry';

import { SiteFrame } from '../../../components/SiteFrame';
import { ToolDetails } from '../../../components/ToolDetails';
import { loadToolFlags } from '../../../lib/flags';
import { JsonLd, pageMetadata, pairJsonLd } from '../../../lib/seo';
import { pairLinks, relatedLinks, shellTool, whyPoints } from '../../../lib/tool';
import { ToolView } from '../../../tools';
import { hasView } from '../../../tools/ids';

// Conversion pair pages (docs/09 → URL scheme): the converter preset to one
// input and output, with copy written for the pair. Only pairs whose tool works.

export function generateStaticParams() {
  // The server build has a page for every pair with copy, so a tool switched
  // on in admin brings its pairs; they answer 404 while it's off.
  const pairs =
    process.env.ETB_TARGET === 'server' ? conversions.filter((pair) => !pair.hold) : livePairs();
  return pairs.filter((pair) => PAIR_COPY[pair.slug]).map((pair) => ({ pair: pair.slug }));
}

type Props = { params: Promise<{ pair: string }> };

function find(slug: string) {
  const pair = conversions.find((candidate) => candidate.slug === slug);
  const copy = PAIR_COPY[slug];
  if (!pair || !copy) return null;
  return { pair, copy, tool: getTool(pair.toolId) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await loadToolFlags();
  const found = find((await params).pair);
  if (!found) return {};
  // Pair pages canonicalise to themselves: they're distinct intents (docs/09).
  return pageMetadata({
    title: found.copy.title,
    description: found.copy.description,
    path: conversionPath(found.pair),
  });
}

export default async function PairPage({ params }: Props) {
  await loadToolFlags();
  const found = find((await params).pair);
  if (!found || found.pair.hold || !hasView(found.tool.id) || !isAvailable(found.tool)) notFound();
  const { pair, copy, tool } = found;
  const category = getCategory(tool.category);
  const title = conversionTitle(pair);
  const shell = {
    ...shellTool(tool),
    name: title,
    h1: copy.h1,
    tagline: copy.tagline,
    howTo: copy.howTo,
  };
  return (
    <SiteFrame current={tool.category}>
      <JsonLd data={pairJsonLd({ path: conversionPath(pair), title }, copy, tool, category)} />
      <ToolView category={tool.category} tool={shell} to={pair.to} />
      <ToolDetails
        name={copy.h1}
        about={{
          title: `About ${pair.from.toUpperCase()} and ${pair.to.toUpperCase()}`,
          paragraphs: copy.about,
        }}
        howTo={copy.howTo}
        why={whyPoints(tool)}
        faq={copy.faq}
        conversions={pairLinks(tool.id, pair.slug)}
        related={[
          { href: toolPath(tool), name: tool.name, summary: tool.summary },
          ...relatedLinks(tool, 3),
        ]}
        category={{
          href: categoryPath(category),
          title: category.title,
          count: toolsInCategory(category.id).length,
        }}
      />
    </SiteFrame>
  );
}
