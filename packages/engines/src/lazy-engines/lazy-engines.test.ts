import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as pages from '../index';
import type { Capabilities, Engine, InputMeta } from '../types';

/** Each engine the index exports lazily, beside the engine itself. */
const PAIRS: [string, () => Promise<Engine<never>>][] = [
  ['imageCodecEngine', () => import('../image/image-codec').then((m) => m.imageCodecEngine)],
  [
    'imageGeometryEngine',
    () => import('../image/image-geometry').then((m) => m.imageGeometryEngine),
  ],
  ['imageMetadataEngine', () => import('../image/metadata').then((m) => m.imageMetadataEngine)],
  ['imagesToPdfEngine', () => import('../image/images-to-pdf').then((m) => m.imagesToPdfEngine)],
  ['collageEngine', () => import('../image/collage').then((m) => m.collageEngine)],
  ['imageSplitEngine', () => import('../image/image-split').then((m) => m.imageSplitEngine)],
  ['socialResizeEngine', () => import('../image/social-resize').then((m) => m.socialResizeEngine)],
  ['watermarkEngine', () => import('../image/watermark').then((m) => m.watermarkEngine)],
  ['lutPreviewEngine', () => import('../image/lut-preview').then((m) => m.lutPreviewEngine)],
  [
    'imageToSvgEngine',
    () => import('../image/vector/image-to-svg').then((m) => m.imageToSvgEngine),
  ],
  ['paletteEngine', () => import('../image/palette').then((m) => m.paletteEngine)],
  ['pickedColorsEngine', () => import('../image/pick').then((m) => m.pickedColorsEngine)],
  ['lutConvertEngine', () => import('../lut-convert').then((m) => m.lutConvertEngine)],
  ['subtitleEngine', () => import('../subtitles').then((m) => m.subtitleEngine)],
  ['subtitleEditEngine', () => import('../subtitles').then((m) => m.subtitleEditEngine)],
  ['subtitleShiftEngine', () => import('../subtitle-shift').then((m) => m.subtitleShiftEngine)],
  ['batchRenameEngine', () => import('../files/batch-rename').then((m) => m.batchRenameEngine)],
];

const ctx = { signal: new AbortController().signal, progress: () => undefined };
const caps: Capabilities = {
  webgpu: false,
  webcodecs: false,
  sharedArrayBuffer: false,
  hardwareConcurrency: 4,
};
const input: InputMeta = { name: 'photo.jpg', type: 'image/jpeg', size: 12_000_000 };

describe('engines that load with their first run', () => {
  it.each(PAIRS)('%s answers as its engine does before it loads', async (name, load) => {
    const page = (pages as unknown as Record<string, Engine<never> | undefined>)[name];
    const engine = await load();
    if (!page) throw new Error(`@etb/engines exports no ${name}`);
    expect(page).not.toBe(engine);
    expect(page.capabilities(caps)).toEqual(engine.capabilities(caps));
    expect(page.estimate(input, {} as never)).toEqual(engine.estimate(input, {} as never));
  });

  it('runs the engine it loads', async () => {
    const ass = new File(
      [
        readFileSync(
          fileURLToPath(new URL('../../../../fixtures/subtitles/features.ass', import.meta.url)),
        ),
      ],
      'features.ass',
    );
    const out = await pages.subtitleEngine.run(ass, { to: 'srt' }, ctx);
    expect(out.ext).toBe('srt');
    expect(out.details).toEqual([
      { label: 'Cues', value: '4 cues' },
      { label: 'Formats', value: 'ASS → SRT' },
    ]);
  });

  it('loads the helpers a page calls as files arrive', async () => {
    const read = await pages.readSubtitleFile(
      new File(['1\n00:00:01,000 --> 00:00:02,000\nHi\n'], 'one.srt'),
    );
    expect(read.format).toBe('srt');
    expect(read.cues).toHaveLength(1);
    const plan = await pages.renamePlan([new File(['a'], 'a.txt')], { prefix: 'x-' });
    expect(plan.names.map((named) => named.to)).toEqual(['x-a.txt']);
    const { readSubtitles } = await pages.loadSubtitleShift();
    expect(typeof readSubtitles).toBe('function');
  });
});
