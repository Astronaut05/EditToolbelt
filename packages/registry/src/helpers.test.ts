import { describe, expect, it } from 'vitest';

import {
  categories,
  conversions,
  getTool,
  livePairs,
  hubOrder,
  isAi,
  isAvailable,
  ISOLATED_PATHS,
  MOST_USED,
  needsFullPageLoad,
  needsWasm,
  redirects,
  runsInBrowser,
  runtimeTag,
  toolPath,
  tools,
  toolsInCategory,
  type ToolDef,
} from '.';
import { buildSearchIndex, normalize, searchIndex } from './search';

describe('lookups', () => {
  it('lists every category with at least one tool', () => {
    for (const category of categories)
      expect(toolsInCategory(category.id).length).toBeGreaterThan(0);
    expect(categories.map((category) => toolsInCategory(category.id).length)).toEqual([
      19, 21, 16, 7, 8, 4,
    ]);
  });

  it('keeps the "Most used" list to real tools', () => {
    expect(MOST_USED).toHaveLength(10);
    for (const id of MOST_USED) expect(() => getTool(id)).not.toThrow();
  });

  it('counts the photo hub filters (the design fixture says AI 3; face blur makes it 4)', () => {
    const photo = toolsInCategory('photo');
    expect(photo.filter(runsInBrowser)).toHaveLength(17);
    expect(photo.filter(isAi).map((tool) => tool.id)).toEqual([
      'remove-background',
      'upscale-image',
      'blur-image',
      'object-eraser',
    ]);
  });

  it('tags runtimes', () => {
    expect(runtimeTag(getTool('remove-background'))).toBe('AI · Browser');
    expect(runtimeTag(getTool('upscale-image'))).toBe('AI · Credits');
    expect(runtimeTag(getTool('resize-image'))).toBe('Browser');
    expect(runtimeTag(getTool('vfr-to-cfr'))).toBe('Credits');
  });

  it('puts working tools before soon ones on hubs', () => {
    const live: ToolDef = { ...getTool('object-eraser'), status: 'live' };
    const ordered = hubOrder([
      ...toolsInCategory('photo').filter((tool) => tool.id !== live.id),
      live,
    ]);
    const firstSoon = ordered.findIndex((tool) => !isAvailable(tool));
    expect(ordered.slice(0, firstSoon).map((tool) => tool.id)).toContain('object-eraser');
    expect(ordered.slice(firstSoon).every((tool) => !isAvailable(tool))).toBe(true);
  });
});

describe('cross-origin isolation list', () => {
  it('equals the tools that need it', () => {
    const expected = tools.filter((tool) => tool.crossOriginIsolated).map(toolPath);
    expect([...ISOLATED_PATHS].sort()).toEqual(expected.sort());
  });

  it('matches paths with a query, hash or trailing slash', () => {
    expect(needsFullPageLoad('/video-converter')).toBe(true);
    expect(needsFullPageLoad('/video-converter/?x=1#y')).toBe(true);
    expect(needsFullPageLoad('/video')).toBe(false);
    expect(needsFullPageLoad('/')).toBe(false);
  });
});

describe('conversion pairs', () => {
  it('are unique and point at converter tools', () => {
    expect(new Set(conversions.map((pair) => pair.slug)).size).toBe(conversions.length);
    for (const pair of conversions) {
      expect(() => getTool(pair.toolId)).not.toThrow();
      expect(pair.slug).toMatch(/^[a-z0-9]+-to-[a-z0-9]+$/);
    }
    expect(conversions).toHaveLength(30);
  });
});

describe('redirects', () => {
  it('never shadow a current page and always land on one', () => {
    const paths = new Set(tools.map(toolPath));
    for (const redirect of redirects) {
      expect(paths.has(redirect.from)).toBe(false);
      expect(paths.has(redirect.to)).toBe(true);
    }
  });
});

describe('search', () => {
  const liveGifs = tools.map((tool) =>
    ['video-to-gif', 'gif-to-mp4'].includes(tool.id) ? { ...tool, status: 'live' as const } : tool,
  );

  it('normalises input', () => {
    expect(normalize('  MP4 → GIF ')).toBe('mp4 gif');
    expect(normalize('Rows × Columns')).toBe('rows x columns');
    expect(normalize('Subtitles & Time')).toBe('subtitles and time');
  });

  it('ranks "mp4 to gif" like the home design: tool, pair, reverse tool', () => {
    const hits = searchIndex(buildSearchIndex(liveGifs, conversions), 'mp4 to gif', 3);
    expect(hits.map((hit) => [hit.title, hit.tag])).toEqual([
      ['Video to GIF', 'video'],
      ['MP4 to GIF', 'convert'],
      ['GIF to MP4', 'video'],
    ]);
  });

  it('lists only pairs whose tool works', () => {
    const index = buildSearchIndex(tools, conversions);
    const pairs = index.filter((entry) => entry.kind === 'pair').map((entry) => entry.path);
    expect(pairs).toEqual(livePairs().map((pair) => `/convert/${pair.slug}`));
    expect(pairs).not.toContain('/convert/mp4-to-gif');
    expect(index.filter((entry) => entry.kind === 'tool')).toHaveLength(75);
  });

  it('finds tools by half-typed words and by secondary queries', () => {
    const index = buildSearchIndex(tools, conversions);
    expect(searchIndex(index, 'remove backg')[0]?.path).toBe('/remove-background');
    expect(searchIndex(index, 'bpm')[0]?.path).toBe('/bpm-key-finder');
    expect(searchIndex(index, 'transparent background maker')[0]?.path).toBe('/remove-background');
    expect(searchIndex(index, '')).toEqual([]);
    expect(searchIndex(index, 'zzzz')).toEqual([]);
  });
});

describe('WASM pages', () => {
  it('only working tools with a WASM engine get wasm-unsafe-eval', () => {
    expect(needsWasm({ ...getTool('image-converter'), status: 'soon' })).toBe(false);
    expect(needsWasm({ ...getTool('image-converter'), status: 'live' })).toBe(true);
    expect(needsWasm({ ...getTool('timecode-calculator'), status: 'live' })).toBe(false);
  });
});
