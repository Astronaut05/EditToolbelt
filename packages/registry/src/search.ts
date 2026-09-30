/**
 * Instant, client-side search over the registry (docs/03 → Layout: "search
 * (instant, client-side over the registry: name, secondary queries, tags)").
 *
 * The build writes a compact index (`buildSearchIndex`) to a static JSON file;
 * the browser loads it on first use and ranks with `searchIndex`. This module
 * imports no tool data, so the ranking code stays tiny in the client bundle.
 */
import type { ConversionPair } from './conversions';
import type { ToolDef } from './schema';

export interface SearchEntry {
  kind: 'tool' | 'pair';
  title: string;
  path: string;
  /** Uppercase mono tag on the right: the category ("VIDEO"), or "CONVERT" for pairs. */
  tag: string;
  summary: string;
  soon: boolean;
  /** Normalised search phrases, best first: primary query, then secondary queries. */
  terms: string[];
}

export interface SearchHit extends SearchEntry {
  score: number;
}

const CATEGORY_TAG: Record<ToolDef['category'], string> = {
  photo: 'photo',
  video: 'video',
  audio: 'audio',
  color: 'color',
  'subtitles-time': 'time',
  utility: 'utility',
};

/** Lowercase, no accents, words separated by single spaces. Keeps the Uzbek ʻ. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/×/g, 'x')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9ʻЀ-ӿ]+/g, ' ')
    .trim();
}

export function buildSearchIndex(
  tools: readonly ToolDef[],
  pairs: readonly ConversionPair[],
): SearchEntry[] {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const entries: SearchEntry[] = [];
  for (const tool of tools) {
    if (tool.status === 'disabled') continue;
    entries.push({
      kind: 'tool',
      title: tool.name,
      path: `/${tool.slug}`,
      tag: CATEGORY_TAG[tool.category],
      summary: tool.summary,
      soon: tool.status === 'soon',
      terms: unique([tool.seo.primaryQuery, ...tool.seo.secondaryQueries, tool.seo.h1]),
    });
  }
  for (const pair of pairs) {
    const tool = byId.get(pair.toolId);
    // A pair page exists only while its tool works and nothing holds it (docs/12 → M2).
    if (pair.hold || (tool?.status !== 'live' && tool?.status !== 'beta')) continue;
    entries.push({
      kind: 'pair',
      title: `${pair.from.toUpperCase()} to ${pair.to.toUpperCase()}`,
      path: `/convert/${pair.slug}`,
      tag: 'convert',
      summary: tool.summary,
      soon: false,
      terms: unique([`${pair.from} to ${pair.to}`, `convert ${pair.from} to ${pair.to}`]),
    });
  }
  return entries;
}

function unique(phrases: string[]): string[] {
  return [...new Set(phrases.map(normalize).filter(Boolean))];
}

/**
 * Scores one entry. Exact phrase > phrase prefix > phrase contains > every
 * typed word found (the last one may be half-typed). Tools rank above the
 * conversion pairs they power, and live tools above `soon` ones on a tie.
 */
function score(entry: SearchEntry, query: string, words: string[]): number {
  const phrases = [normalize(entry.title), ...entry.terms];
  let best = 0;
  phrases.forEach((phrase, index) => {
    const rank = index === 0 ? 0 : index === 1 ? 4 : 8;
    if (phrase === query) best = Math.max(best, 100 - rank);
    else if (phrase.startsWith(query)) best = Math.max(best, 80 - rank);
    else if (` ${phrase} `.includes(` ${query}`)) best = Math.max(best, 60 - rank);
  });
  if (best === 0) {
    const vocabulary = new Set(phrases.join(' ').split(' '));
    const found = words.every((word, index) => {
      if (vocabulary.has(word)) return true;
      // The word being typed can be a prefix.
      return index === words.length - 1 && [...vocabulary].some((known) => known.startsWith(word));
    });
    if (found) best = 40;
  }
  if (best === 0) return 0;
  if (entry.kind === 'pair') best -= 10;
  if (entry.soon) best -= 1;
  return best;
}

export function searchIndex(
  entries: readonly SearchEntry[],
  rawQuery: string,
  limit = 8,
): SearchHit[] {
  const query = normalize(rawQuery);
  if (!query) return [];
  const words = query.split(' ').filter((word) => word !== 'to' || query === 'to');
  return entries
    .map((entry, order) => ({ entry, order, score: score(entry, query, words) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ entry, score: value }) => ({ ...entry, score: value }));
}
