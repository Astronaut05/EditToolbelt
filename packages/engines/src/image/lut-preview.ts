/**
 * C05 LUT Preview (tools/color.md): a `.cube` LUT applied to a still in the
 * image worker, at an intensity, and saved in the format picked. The LUT is
 * read here, so a broken file says what's wrong and on which line before
 * anything is decoded. Neither file leaves the browser.
 */
import { LutError, parseCube, type Lut } from '@etb/core/lut';

import type { Engine, EngineOutput } from '../types';
import {
  baseJob,
  checkImage,
  imageCodecEngine,
  ImageInputError,
  runImageJob,
  type ImageCodecOptions,
} from './image-codec';
import { OUTPUT_EXT, OUTPUT_MIME } from './protocol';
import { FORMAT_LABELS } from './sniff';

export interface LutPreviewOptions extends Pick<
  ImageCodecOptions,
  'format' | 'quality' | 'background' | 'metadata'
> {
  /** The `.cube` file (the page passes the chosen file). */
  lut?: Blob;
  /** 0-100, how much of the LUT. */
  intensity?: string;
}

/** Biggest `.cube` read: a 65³ LUT is about 7 MB of text. */
const MAX_CUBE_BYTES = 32 * 1024 * 1024;

/** "Teal & Orange · 33³ cube": what a LUT is, for the notes. */
export function lutLabel(lut: Lut, name: string): string {
  const what =
    lut.dimensions === 3 ? `${String(lut.size)}³ cube` : `1D, ${String(lut.size)} points`;
  return `${lut.title || name.replace(/\.cube$/i, '') || 'LUT'} · ${what}`;
}

export async function readLut(file: Blob): Promise<Lut> {
  if (file.size > MAX_CUBE_BYTES) {
    throw new ImageInputError('This LUT file is over 32 MB; a .cube is usually well under 10 MB.');
  }
  try {
    return parseCube(await file.text());
  } catch (error) {
    if (error instanceof LutError) {
      throw new ImageInputError(`This .cube LUT can’t be read. ${error.message}.`);
    }
    throw error;
  }
}

export const lutPreviewEngine: Engine<LutPreviewOptions> = {
  capabilities: (caps) => imageCodecEngine.capabilities(caps),
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 3_000_000) }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    if (!opts.lut) throw new ImageInputError('Choose a .cube LUT.');
    const lut = await readLut(opts.lut);
    const intensity = Math.min(100, Math.max(0, Number(opts.intensity ?? 100) || 0)) / 100;
    const label = lutLabel(lut, opts.lut instanceof File ? opts.lut.name : '');
    const bytes = await input.arrayBuffer();
    const format = checkImage(new Uint8Array(bytes), input.size);
    const done = await runImageJob(
      { ...baseJob(bytes, format, opts), lut: { lut, intensity, label } },
      ctx.signal,
      (fraction, stage) => {
        ctx.progress(fraction, stage);
      },
    );
    const ext = OUTPUT_EXT[done.output];
    return {
      blob: new Blob([done.bytes], { type: OUTPUT_MIME[done.output] }),
      ext,
      width: done.width,
      height: done.height,
      path: 'Browser · WASM',
      notes: done.notes,
      nameSuffix: 'graded',
      details: [
        { label: 'LUT', value: label },
        { label: 'Intensity', value: `${String(Math.round(intensity * 100))}%` },
        { label: 'Formats', value: `${FORMAT_LABELS[format]} → ${ext.toUpperCase()}` },
        ...(done.quality === undefined ? [] : [{ label: 'Quality', value: String(done.quality) }]),
      ],
    };
  },
};
