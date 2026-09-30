/**
 * @etb/registry: tool registry, the source of truth for every tool (docs/02-tool-framework.md).
 *
 * Pages, sitemap, hubs, search, admin and the API read tools from here; nothing
 * about a tool is written down twice (CLAUDE.md rule 3). The Zod schema lives in
 * ./schema and is checked in tests, so it never ships to the browser.
 */
import { categories, getCategory, type Category } from './categories';
import type { CategoryId, EngineId, ToolDef } from './schema';
import { conversions, type ConversionPair } from './conversions';
import { statusOf } from './flags';
import { tools } from './tools';

export { categories, getCategory, type Category };
export { conversions, conversionPath, conversionTitle, type ConversionPair } from './conversions';
export {
  costOf,
  hasServerPath,
  limitsOf,
  maintenanceMessage,
  setToolFlags,
  statusOf,
  surfacesOf,
  toolFlag,
  type ToolFlag,
} from './flags';
export { ISOLATED_PATHS, needsFullPageLoad } from './isolated';
export { PAIR_COPY, type PairCopy } from './pairs';
export { redirects, type Redirect } from './redirects';
export { tools };
export type {
  CategoryId,
  CreditRule,
  EngineId,
  Runtime,
  Surface,
  ToolDef,
  ToolStatus,
  UiType,
} from './schema';

const byId = new Map(tools.map((tool) => [tool.id, tool]));
const bySlug = new Map(tools.map((tool) => [tool.slug, tool]));

export function getTool(id: string): ToolDef {
  const tool = byId.get(id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}

export function findToolBySlug(slug: string): ToolDef | undefined {
  return bySlug.get(slug);
}

export function toolPath(tool: Pick<ToolDef, 'slug'>): string {
  return `/${tool.slug}`;
}

export function categoryPath(category: Pick<Category, 'slug'>): string {
  return `/${category.slug}`;
}

/** Tools that have a working page (hub rows link to them, sitemap lists them). */
export function isAvailable(tool: Pick<ToolDef, 'id' | 'status'>): boolean {
  const status = statusOf(tool);
  return status === 'live' || status === 'beta';
}

/** Hidden everywhere; the page answers 404 (docs/02 → Status behaviour). */
export function isListed(tool: Pick<ToolDef, 'id' | 'status'>): boolean {
  return statusOf(tool) !== 'disabled';
}

export function toolsInCategory(id: CategoryId): ToolDef[] {
  return tools.filter((tool) => tool.category === id && isListed(tool));
}

/**
 * Hub order: working tools first, `soon` last (docs/02 → Status behaviour),
 * each group in wave, then tools/README.md order.
 */
export function hubOrder(list: readonly ToolDef[]): ToolDef[] {
  return list
    .map((tool, index) => ({ tool, index }))
    .sort(
      (a, b) =>
        Number(!isAvailable(a.tool)) - Number(!isAvailable(b.tool)) ||
        a.tool.wave - b.tool.wave ||
        a.index - b.index,
    )
    .map(({ tool }) => tool);
}

const ML_ENGINES: ReadonlySet<EngineId> = new Set([
  'image-ml',
  'image-ml-server',
  'video-ml-server',
  'audio-ml-server',
]);

export function isAi(tool: Pick<ToolDef, 'engines'>): boolean {
  return tool.engines.some((engine) => ML_ENGINES.has(engine));
}

/** Runs in the browser (fully, or browser-first with a server fallback). */
export function runsInBrowser(tool: Pick<ToolDef, 'runtime'>): boolean {
  return tool.runtime === 'client' || tool.runtime === 'hybrid';
}

/**
 * Engines that compile WebAssembly in the browser. Their pages need
 * `'wasm-unsafe-eval'` in the CSP (docs/11 → only on tool routes that need
 * WASM). Refined per engine as the engines land in M2.
 */
export const WASM_ENGINES: ReadonlySet<EngineId> = new Set([
  'image-codec',
  'image-vector',
  'image-ml',
  'video-webcodecs',
  'video-ffmpeg-wasm',
  'audio-dsp',
  'media-probe',
]);

/** A working tool page that loads WebAssembly. `soon` pages load no tool code. */
export function needsWasm(tool: Pick<ToolDef, 'id' | 'engines' | 'status'>): boolean {
  return isAvailable(tool) && tool.engines.some((engine) => WASM_ENGINES.has(engine));
}

/** The mono runtime tag on hub rows: BROWSER, AI · BROWSER, AI · CREDITS, CREDITS. */
export function runtimeTag(tool: Pick<ToolDef, 'runtime' | 'engines'>): string {
  const where = runsInBrowser(tool) ? 'Browser' : 'Credits';
  return isAi(tool) ? `AI · ${where}` : where;
}

/**
 * Home → "Most used". A fixed list until analytics can rank tools
 * (docs/03 → Layout).
 */
export const MOST_USED: readonly string[] = [
  'remove-background',
  'compress-video',
  'trim-video',
  'image-converter',
  'resize-image',
  'video-to-gif',
  'extract-audio',
  'compress-image',
  'timecode-calculator',
  'subtitle-converter',
];

/** "Until then, try": related tools that work today, else nothing. */
export function availableRelated(tool: ToolDef): ToolDef[] {
  return tool.related.map((id) => getTool(id)).filter(isAvailable);
}

/** Conversion pairs that have a page: their tool works and nothing holds them (docs/12 → M2). */
export function livePairs(toolId?: string): ConversionPair[] {
  return conversions.filter(
    (pair) =>
      (toolId === undefined || pair.toolId === toolId) &&
      !pair.hold &&
      isAvailable(getTool(pair.toolId)),
  );
}
