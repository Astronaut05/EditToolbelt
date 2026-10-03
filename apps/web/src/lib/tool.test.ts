import { getTool, isAvailable, setToolFlags, tools, type ToolDef } from '@etb/registry';
import { describe, expect, it } from 'vitest';

import { hasView, VIEW_IDS } from '../tools/ids';
import { relatedLinks, shellTool, whyPoints } from './tool';

describe('live tool pages', () => {
  it('every live or beta tool has a view', () => {
    const missing = tools.filter((tool) => isAvailable(tool) && !hasView(tool.id));
    expect(missing.map((tool) => tool.id)).toEqual([]);
  });

  it("lists every view under its tool's registry category, which picks its index", () => {
    const misplaced = Object.entries(VIEW_IDS).flatMap(([category, ids]) =>
      ids.filter((id) => getTool(id).category !== category),
    );
    expect(misplaced).toEqual([]);
  });

  it('maps the registry entry to the shell', () => {
    const shell = shellTool(getTool('timecode-calculator'));
    expect(shell).toMatchObject({
      id: 'timecode-calculator',
      h1: 'Timecode Calculator',
      ui: 'calculator',
      category: { name: 'Subtitles & Time', href: '/subtitles-time' },
    });
  });

  it('carries the registry’s browser limit, or an admin’s override of it', () => {
    expect(shellTool(getTool('audio-converter')).maxBytes).toBe(1024 ** 3);
    expect(shellTool(getTool('compress-image')).maxBytes).toBe(200 * 1024 ** 2);
    // A server tool has none: its page sets the drop zone's own.
    expect(shellTool(getTool('upscale-image'))).not.toHaveProperty('maxBytes');
    try {
      setToolFlags(new Map([['audio-converter', { limits: { client: { maxBytes: 5_000 } } }]]));
      expect(shellTool(getTool('audio-converter')).maxBytes).toBe(5_000);
    } finally {
      setToolFlags(new Map());
    }
  });
});

describe('relatedLinks', () => {
  it('links only to working tools, topped up from the category', () => {
    const links = relatedLinks(getTool('aspect-ratio-calculator'));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const tool = tools.find((candidate) => `/${candidate.slug}` === link.href);
      expect(tool && isAvailable(tool), link.href).toBe(true);
    }
    expect(links.map((link) => link.href)).not.toContain('/aspect-ratio-calculator');
  });

  it('puts the registry picks first once they work', () => {
    const tool = getTool('aspect-ratio-calculator');
    const withLiveResize: ToolDef = { ...tool, related: ['bitrate-calculator', ...tool.related] };
    expect(relatedLinks(withLiveResize)[0]?.href).toBe('/bitrate-calculator');
  });
});

describe('whyPoints', () => {
  it('gives three lines that match how the tool runs', () => {
    const calc = whyPoints(getTool('timecode-calculator'));
    expect(calc).toHaveLength(3);
    expect(calc[0]).toMatch(/as you type/);
    expect(calc[2]).toMatch(/^Free/);
    const server = whyPoints(getTool('upscale-image'));
    expect(server[1]).toMatch(/deleted/);
    expect(server[2]).toMatch(/credits/);
    const hybrid = whyPoints(getTool('remove-background'));
    expect(hybrid[2]).toMatch(/^Free in your browser/);
  });

  it('never uses em or en dashes (docs/03 → Copy)', () => {
    for (const tool of tools) for (const line of whyPoints(tool)) expect(line).not.toMatch(/[–—]/);
  });
});
