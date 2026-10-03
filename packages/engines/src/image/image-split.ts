/**
 * `image-geometry` for P14 Split Image into Grid (tools/photo.md): one image
 * in, a ZIP of tiles out, cut and encoded in the image worker from a single
 * decode. Tiles keep the source's format unless another is picked.
 */
import { gridOf, SPLIT_META } from '../lazy-engines/image-split';
import { safeStem } from '../names';
import type { Engine, EngineOutput } from '../types';
import { baseJob, checkImage, type ImageCodecOptions, runImageJob } from './image-codec';
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

export { gridOf };

export const imageSplitEngine: Engine<ImageSplitOptions> = {
  ...SPLIT_META,
  async run(input, opts, ctx): Promise<EngineOutput> {
    const bytes = await input.arrayBuffer();
    const format = checkImage(new Uint8Array(bytes), input.size);
    const stem = safeStem(input instanceof File ? input.name : 'image', 'image');
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
