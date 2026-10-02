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
  maintenanceMessage,
  needsWasm,
  toolPath,
  tools,
  toolsInCategory,
  type Category,
  type ToolDef,
} from '@etb/registry';
import { Breadcrumb, CapabilityNotice } from '@etb/ui';

import { ComingSoon, type SoonLink } from '../../components/ComingSoon';
import { HubList } from '../../components/HubList';
import { SiteFrame } from '../../components/SiteFrame';
import { ToolDetails } from '../../components/ToolDetails';
import { loadToolFlags } from '../../lib/flags';
import { hubRows } from '../../lib/hub';
import { breadcrumbJsonLd, JsonLd, pageMetadata, toolJsonLd } from '../../lib/seo';
import { pairLinks, relatedLinks, shellTool, whyPoints } from '../../lib/tool';
import { ToolView } from '../../tools';
import { hasView } from '../../tools/ids';

// Hubs (/photo) and tools (/remove-background) share the top level
// (docs/09 → URL scheme), so one route renders both from the registry.

export function generateStaticParams() {
  return [
    ...categories.map((category) => ({ slug: category.slug })),
    // The server build has a page for every tool, so admin can switch a
    // disabled one on; it answers 404 while disabled.
    ...tools
      .filter((tool) => process.env.ETB_TARGET === 'server' || isListed(tool))
      .map((tool) => ({ slug: tool.slug })),
  ];
}

type Props = { params: Promise<{ slug: string }> };

function findCategory(slug: string): Category | undefined {
  return categories.find((category) => category.slug === slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await loadToolFlags();
  const { slug } = await params;
  const category = findCategory(slug);
  if (category) {
    return pageMetadata({
      title: category.seoTitle,
      description: category.seoDescription,
      path: categoryPath(category),
    });
  }
  const tool = findToolBySlug(slug);
  if (!tool) return {};
  return {
    // Placeholders stay out of search (docs/09 → Quality rules).
    ...pageMetadata({
      title: tool.seo.title,
      description: tool.seo.description,
      path: toolPath(tool),
      noindex: !isAvailable(tool),
    }),
    // Read and removed by scripts/postbuild.ts: adds 'wasm-unsafe-eval' to this page's CSP.
    other: needsWasm(tool) ? { 'etb-csp': 'wasm' } : undefined,
  };
}

function Hub({ category }: { category: Category }) {
  return (
    <SiteFrame current={category.id}>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: category.name, path: categoryPath(category) },
        ])}
      />
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

/** A working tool: the workspace right under the H1, then the page template of docs/09. */
function LiveTool({ tool }: { tool: ToolDef }) {
  const category = getCategory(tool.category);
  if (!hasView(tool.id))
    throw new Error(`${tool.id} is ${tool.status} but has no view in src/tools`);
  const maintenance = maintenanceMessage(tool);
  return (
    <SiteFrame current={tool.category}>
      <JsonLd data={toolJsonLd(tool, category)} />
      {maintenance && (
        <div className="px-4 pt-4 lg:px-10">
          <CapabilityNotice title="Maintenance">{maintenance}</CapabilityNotice>
        </div>
      )}
      <ToolView category={tool.category} tool={shellTool(tool)} />
      <ToolDetails
        name={tool.name}
        howTo={tool.seo.howTo ?? []}
        why={whyPoints(tool)}
        faq={tool.seo.faq ?? []}
        conversions={pairLinks(tool.id)}
        related={relatedLinks(tool)}
        category={{
          href: categoryPath(category),
          title: category.title,
          count: toolsInCategory(category.id).length,
        }}
      />
    </SiteFrame>
  );
}

/** A `soon` tool: the noindex placeholder (design: soon-upscale). */
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
      <JsonLd data={toolJsonLd(tool, category)} />
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
  await loadToolFlags();
  const { slug } = await params;
  const category = findCategory(slug);
  if (category) return <Hub category={category} />;
  const tool = findToolBySlug(slug);
  if (!tool || !isListed(tool)) notFound();
  return isAvailable(tool) ? <LiveTool tool={tool} /> : <Tool tool={tool} />;
}
