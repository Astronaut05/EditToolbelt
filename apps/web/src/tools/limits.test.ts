/**
 * Browser limits come from the registry (CLAUDE.md rule 3; docs/decisions →
 * "Browser limits come from the registry"). The shell checks and states a
 * tool's `limits.client.maxBytes`, so a page whose tool has one neither sets
 * `maxBytes` nor writes the size into its copy, and the engines' own checks
 * hold the same number. Server tools have no browser limit in the registry:
 * their pages set the drop zone's own and state their server limits.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AUDIO_LIMITS, GIF_INPUT_LIMITS, PALETTE_LIMITS, VIDEO_LIMITS } from '@etb/engines';
import { getTool, limitsOf } from '@etb/registry';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { TOOL_IDS } from './ids';

const DIR = fileURLToPath(new URL('.', import.meta.url));

/** "up to" and a size in one piece of copy: "up to 1 GB", "each up to 20 MB", "up to 24 MP, 200 MB". */
const SIZE_PHRASE = /\bup to\b.*?\b\d[\d,.]*\s?[KMGT]B\b/;

const clientLimit = (id: string) => limitsOf(getTool(id))?.client?.maxBytes;
const source = (name: string) => readFileSync(`${DIR}${name}`, 'utf8');

/** Where a file sets `maxBytes`, and the copy in it that states a size. */
function scan(name: string): { maxBytes: number[]; sizes: string[] } {
  const file = ts.createSourceFile(name, source(name), ts.ScriptTarget.Latest, true);
  const found = { maxBytes: [] as number[], sizes: [] as string[] };
  const visit = (node: ts.Node) => {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      node.name.getText(file) === 'maxBytes'
    ) {
      found.maxBytes.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    // Strings and the pieces of template literals, never comments.
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      if (SIZE_PHRASE.test(node.text)) found.sizes.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('browser limits', () => {
  it('no page whose tool has one in the registry sets it or writes its size', () => {
    // Tool pages and the shared bits they spread (image-presets.ts, video-presets.ts …).
    const files = readdirSync(DIR).filter((name) => {
      if (!/\.tsx?$/.test(name) || name.endsWith('.test.ts')) return false;
      const id = name.replace(/\.tsx?$/, '');
      return !(TOOL_IDS as readonly string[]).includes(id) || clientLimit(id) !== undefined;
    });
    expect(files.length).toBeGreaterThan(50);
    const found = files.flatMap((name) => {
      const { maxBytes, sizes } = scan(name);
      return [
        ...maxBytes.map((line) => `${name}:${String(line)} sets maxBytes`),
        ...sizes.map((text) => `${name} says "${text}"`),
      ];
    });
    expect(found).toEqual([]);
  });

  it('every tool that takes files has one: the registry’s, else its page’s', () => {
    const missing = TOOL_IDS.filter(
      (id) =>
        getTool(id).ui !== 'calculator' &&
        clientLimit(id) === undefined &&
        scan(`${id}.tsx`).maxBytes.length === 0,
    );
    expect(missing).toEqual([]);
  });

  it('the engines check the same limits as the registry', () => {
    const limited = TOOL_IDS.filter((id) => clientLimit(id) !== undefined);
    const engines: [string, number, string[]][] = [
      // The video engines' probe checks it for every tool on the shared video intake.
      [
        'VIDEO_LIMITS',
        VIDEO_LIMITS.maxBytes,
        limited.filter((id) => source(`${id}.tsx`).includes('VIDEO_INTAKE')),
      ],
      ['GIF_INPUT_LIMITS', GIF_INPUT_LIMITS.maxBytes, ['gif-to-mp4']],
      ['PALETTE_LIMITS', PALETTE_LIMITS.maxBytes, ['color-palette-from-image']],
      // tools/audio.md → Limits (browser): one for every audio tool.
      [
        'AUDIO_LIMITS',
        AUDIO_LIMITS.maxBytes,
        limited.filter((id) => getTool(id).category === 'audio'),
      ],
    ];
    for (const [name, maxBytes, ids] of engines) {
      expect(ids.length, name).toBeGreaterThan(0);
      for (const id of ids) expect(clientLimit(id), `${name} · ${id}`).toBe(maxBytes);
    }
  });
});
