import {
  availableRelated,
  costOf,
  conversionPath,
  hasServerPath,
  limitsOf,
  priceLabel,
  livePairs,
  PAIR_COPY,
  categoryPath,
  getCategory,
  hubOrder,
  isAvailable,
  runsInBrowser,
  toolPath,
  toolsInCategory,
  type ToolDef,
} from '@etb/registry';
import type { ShellTool } from '@etb/ui';

/** What the client-side shell needs from a registry entry (serialisable). */
export function shellTool(tool: ToolDef): ShellTool {
  const category = getCategory(tool.category);
  return {
    id: tool.id,
    name: tool.name,
    h1: tool.seo.h1,
    tagline: tool.tagline,
    runtime: tool.runtime,
    ui: tool.ui,
    category: { name: category.name, href: categoryPath(category) },
    related: relatedLinks(tool).map(({ name, href, id, accepts }) => ({
      name,
      href,
      id,
      accepts,
    })),
    howTo: tool.seo.howTo,
    ...(serverInfo(tool) && { server: serverInfo(tool) }),
  };
}

/**
 * A hybrid tool's server path, once an admin has switched it on. Only the
 * server build knows (it reads the switch from the database); the static
 * export never offers it.
 */
function serverInfo(tool: ToolDef): ShellTool['server'] {
  const server = limitsOf(tool)?.server;
  if (tool.runtime !== 'hybrid' || !hasServerPath(tool) || !server) return undefined;
  const rule = costOf(tool);
  return {
    rule,
    price: priceLabel(rule),
    maxBytes: { free: server.free.maxBytes, paid: server.paid.maxBytes },
  };
}

export interface RelatedLink {
  href: string;
  name: string;
  summary: string;
  /** Tool links carry the tool's id and file types, for the in-memory handoff of a result. */
  id?: string;
  /** File types the tool takes, for the in-memory handoff of a result. */
  accepts?: string[];
}

/**
 * Related tools that work today (docs/09 → internal linking: 3-6 per tool),
 * topped up from the same category while the registry's own picks are `soon`.
 */
export function relatedLinks(tool: ToolDef, max = 4): RelatedLink[] {
  const picked = availableRelated(tool);
  const seen = new Set([tool.id, ...picked.map((related) => related.id)]);
  const fill = hubOrder(toolsInCategory(tool.category)).filter(
    (other) => isAvailable(other) && !seen.has(other.id),
  );
  return [...picked, ...fill].slice(0, max).map((related) => ({
    href: toolPath(related),
    name: related.name,
    summary: related.summary,
    id: related.id,
    accepts: related.accepts,
  }));
}

/**
 * "Why use this" (docs/09 → Page template): speed, privacy, free or not.
 * Three short lines, true for this tool, built from its registry entry.
 */
export function whyPoints(tool: ToolDef): string[] {
  const calculator = tool.ui === 'calculator';
  const speed = calculator
    ? 'Instant. Results update as you type, with nothing to press.'
    : runsInBrowser(tool)
      ? 'Fast. Your file is processed on your device, so there is no upload and no queue.'
      : 'Heavy lifting on our servers, so your laptop or phone stays free.';
  const privacy = calculator
    ? 'Private. What you type stays on this page; the link you share holds only the numbers.'
    : tool.runtime === 'client'
      ? 'Private. Your files never leave your device.'
      : tool.runtime === 'hybrid'
        ? 'Private by default. Your file stays on your device unless you choose server processing.'
        : 'Private. Uploads are deleted when the job finishes and results within 1 hour.';
  // Hybrid tools are free on the device; only the server path they offer costs credits.
  const cost =
    tool.cost.kind === 'free'
      ? 'Free, with no sign-up and no watermark.'
      : tool.runtime === 'hybrid'
        ? 'Free in your browser, with no sign-up and no watermark. Only server processing costs credits.'
        : 'Paid with credits, charged only when the job succeeds. Failed jobs refund automatically.';
  return [speed, privacy, cost];
}

/** Links to a tool's conversion pair pages (docs/09 → internal linking), optionally minus one. */
export function pairLinks(toolId: string, except?: string): RelatedLink[] {
  return livePairs(toolId)
    .filter((pair) => pair.slug !== except && PAIR_COPY[pair.slug])
    .map((pair) => ({
      href: conversionPath(pair),
      name: PAIR_COPY[pair.slug]?.h1 ?? pair.slug,
      summary: `${pair.from.toUpperCase()} in, ${pair.to.toUpperCase()} out`,
    }));
}
