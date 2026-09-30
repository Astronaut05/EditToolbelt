/**
 * Page metadata and structured data from the registry (docs/09 → Page
 * template, Technical SEO). Absolute URLs come from SITE_URL via
 * metadataBase / absoluteUrl, never a hard-coded host.
 */
import type { Metadata } from 'next';

import { isAvailable, type Category, type ToolDef } from '@etb/registry';

import { absoluteUrl } from './urls';

export const SITE_NAME = 'EditToolbelt';

export function pageMetadata({
  title,
  description,
  path,
  noindex = false,
}: {
  title: string;
  description?: string;
  path: string;
  noindex?: boolean;
}): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    robots: noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      type: 'website',
      locale: 'en',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

type Json = Record<string, unknown>;

/** JSON-LD script; `<` is escaped so the data can't close the tag. */
export function JsonLd({ data }: { data: Json | Json[] }) {
  return (
    <script
      type="application/ld+json"
      // Built only from our own registry (docs/11 → the one allowed use).
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

function appJsonLd(app: { name: string; path: string; description: string; free: boolean }): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: app.name,
    url: absoluteUrl(app.path),
    description: app.description,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any (web browser)',
    isAccessibleForFree: app.free,
    ...(app.free ? { offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } } : {}),
  };
}

function faqJsonLd(faq: readonly { q: string; a: string }[] | undefined): Json[] {
  if (!faq?.length) return [];
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    },
  ];
}

/** WebApplication for working tools; `soon` placeholders get none (they're noindex). */
export function toolJsonLd(tool: ToolDef, category: Category): Json[] {
  const crumbs = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: category.name, path: `/${category.slug}` },
    { name: tool.name, path: `/${tool.slug}` },
  ]);
  if (!isAvailable(tool)) return [crumbs];
  const app = appJsonLd({
    name: tool.seo.h1,
    path: `/${tool.slug}`,
    description: tool.seo.description,
    free: tool.cost.kind === 'free',
  });
  return [app, crumbs, ...faqJsonLd(tool.seo.faq)];
}

/** A conversion pair page: its own WebApplication, breadcrumb through the converter, FAQ. */
export function pairJsonLd(
  pair: { path: string; title: string },
  copy: { h1: string; description: string; faq: readonly { q: string; a: string }[] },
  tool: ToolDef,
  category: Category,
): Json[] {
  return [
    appJsonLd({
      name: copy.h1,
      path: pair.path,
      description: copy.description,
      free: tool.cost.kind === 'free',
    }),
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: category.name, path: `/${category.slug}` },
      { name: tool.name, path: `/${tool.slug}` },
      { name: pair.title, path: pair.path },
    ]),
    ...faqJsonLd(copy.faq),
  ];
}

export function websiteJsonLd(): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: absoluteUrl('/'),
  };
}
