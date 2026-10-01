/**
 * `image-geometry` for P14 Split Image into Grid (tools/photo.md): one image
 * in, a ZIP of tiles out, cut and encoded in the image worker from a single
 * decode. Tiles keep the source's format unless another is picked.
 */
import type { Engine, EngineOutput } from '../types';
import type { GridSpec } from './grid';
import {
  baseJob,
  checkImage,
  imageCodecEngine,
  type ImageCodecOptions,
  runImageJob,
} from './image-codec';
import { OUTPUT_EXT } from './protocol';

export interface ImageSplitOptions extends Pick<
  ImageCodecOptions,
  'format' | 'quality' | 'background' | 'metadata'
> {
  /** "3x3": rows × columns, or "custom" with `rows` and `cols`. */
  grid?: string;
  rows?: string;
  cols?: string;
  /** Share of a tile's width left out between tiles: "0", "0.01", "0.025". */
  gap?: string;
  remainder?: string;
  order?: string;
}

/** The grid from the options: "1x3" → 1 row, 3 columns. */
export function gridOf(opts: ImageSplitOptions): Omit<GridSpec, never> {
  const [rows, cols] =
    opts.grid && opts.grid !== 'custom'
      ? opts.grid.split('x').map(Number)
      : [Number(opts.rows), Number(opts.cols)];
  const gap = Number(opts.gap);
  return {
    rows: rows ?? 0,
    cols: cols ?? 0,
    gap: Number.isFinite(gap) ? gap : 0,
    remainder: opts.remainder === 'spread' ? 'spread' : 'equal',
    order: opts.order === 'posting' ? 'posting' : 'rows',
  };
}

/** A safe file-name stem from the original name: letters, digits, dashes and underscores. */
export function stemOf(name: string): string {
  const stem = name
    .replace(/\.[^.]*$/, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return stem || 'image';
}

export const imageSplitEngine: Engine<ImageSplitOptions> = {
  capabilities: (caps) => imageCodecEngine.capabilities(caps),
  estimate: (input, opts) => {
    const grid = gridOf(opts);
    return { seconds: Math.max(0.5, (input.size / 3_000_000) * (1 + grid.rows * grid.cols * 0.2)) };
  },
  async run(input, opts, ctx): Promise<EngineOutput> {
    const bytes = await input.arrayBuffer();
    const format = checkImage(new Uint8Array(bytes), input.size);
    const stem = stemOf(input instanceof File ? input.name : 'image');
    const done = await runImageJob(
      // Tiles skip PNG's slow lossless pass: a dozen of them would take a minute.
      { ...baseJob(bytes, format, opts), optimise: false, tiles: { ...gridOf(opts), stem } },
      ctx.signal,
      (fraction, stage) => {
        ctx.progress(fraction, stage);
      },
    );
    return {
      blob: new Blob([done.bytes], { type: 'application/zip' }),
      ext: 'zip',
      path: 'Browser · WASM',
      notes: done.notes,
      details: [
        { label: 'Tiles', value: String(done.tiles ?? 0) },
        { label: 'Each tile', value: `${String(done.width)} × ${String(done.height)} px` },
        { label: 'Format', value: OUTPUT_EXT[done.output].toUpperCase() },
      ],
    };
  },
};
