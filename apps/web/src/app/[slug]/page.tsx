import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  availableRelated,
  categories,
  categoryPath,
  findToolBySlug,
  getCategory,
  isAvailable,
  isListed,
  toolPath,
  tools,
  toolsInCategory,
  type Category,
  type ToolDef,
} from '@etb/registry';
import { Breadcrumb } from '@etb/ui';

import { ComingSoon, type SoonLink } from '../../components/ComingSoon';
import { HubList } from '../../components/HubList';
import { SiteFrame } from '../../components/SiteFrame';
import { hubRows } from '../../lib/hub';

// Hubs (/photo) and tools (/remove-background) share the top level
// (docs/09 → URL scheme), so one route renders both from the registry.
export const dynamicParams = false;

export function generateStaticParams() {
  return [
    ...categories.map((category) => ({ slug: category.slug })),
    ...tools.filter(isListed).map((tool) => ({ slug: tool.slug })),
  ];
}

type Props = { params: Promise<{ slug: string }> };

function findCategory(slug: string): Category | undefined {
  return categories.find((category) => category.slug === slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = findCategory(slug);
  if (category) {
    return {
      title: { absolute: category.seoTitle },
      description: category.seoDescription,
      alternates: { canonical: categoryPath(category) },
    };
  }
  const tool = findToolBySlug(slug);
  if (!tool) return {};
  return {
    title: { absolute: tool.seo.title },
    description: tool.seo.description,
    alternates: { canonical: toolPath(tool) },
    // Placeholders stay out of search (docs/09 → Quality rules).
    robots: isAvailable(tool) ? undefined : { index: false, follow: true },
  };
}

function Hub({ category }: { category: Category }) {
  return (
    <SiteFrame current={category.id}>
      <div className="px-4 pt-5.5 lg:px-10 lg:pt-8.5">
        <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: category.name }]} />
        <h1 className="mt-3 text-46 leading-display-xl font-display tracking-display-xl lg:mt-4.5 lg:text-72">
          {category.title}
        </h1>
        <HubList rows={hubRows(toolsInCategory(category.id))} lead={category.lead} />
      </div>
    </SiteFrame>
  );
}

function Tool({ tool }: { tool: ToolDef }) {
  const category = getCategory(tool.category);
  const working = availableRelated(tool);
  const tryLinks: SoonLink[] =
    working.length > 0
      ? working.slice(0, 3).map((related) => ({
          href: toolPath(related),
          name: related.name,
          summary: related.summary,
        }))
      : [
          {
            href: categoryPath(category),
            name: category.title,
            summary: `All ${String(toolsInCategory(category.id).length)} ${category.name.toLowerCase()} tools`,
          },
          {
            href: '/',
            name: 'Search every tool',
            summary: `${String(tools.filter(isListed).length)} tools in ${String(categories.length)} categories`,
          },
        ];
  return (
    <SiteFrame current={tool.category}>
      <ComingSoon
        category={{ name: category.name, href: categoryPath(category) }}
        name={tool.name}
        h1={tool.seo.h1}
        tagline={tool.tagline}
        willDo={tool.willDo}
        tryLinks={tryLinks}
        panelLabel={
          working.length > 0 ? 'Until then, try' : `More ${category.name.toLowerCase()} tools`
        }
      />
    </SiteFrame>
  );
}

export default async function SlugPage({ params }: Props) {
  const { slug } = await params;
  const category = findCategory(slug);
  if (category) return <Hub category={category} />;
  const tool = findToolBySlug(slug);
  if (!tool || !isListed(tool)) notFound();
  // Live and beta tools render the ToolShell from M2 on; every tool is `soon` in M1.
  return <Tool tool={tool} />;
}
