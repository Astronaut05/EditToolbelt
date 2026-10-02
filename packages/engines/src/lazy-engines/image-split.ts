import { codecCapabilities } from '../image/codec-support';
import type { GridSpec } from '../image/grid';
import type { ImageSplitOptions } from '../image/image-split';
import { lazyEngine, type EngineMeta } from '../lazy';

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

/** P14 Split Image into Grid, before the engine loads. */
export const SPLIT_META: EngineMeta<ImageSplitOptions> = {
  capabilities: codecCapabilities,
  estimate: (input, opts) => {
    const grid = gridOf(opts);
    return { seconds: Math.max(0.5, (input.size / 3_000_000) * (1 + grid.rows * grid.cols * 0.2)) };
  },
};

export const imageSplitEngine = lazyEngine(
  () => import('../image/image-split').then((m) => m.imageSplitEngine),
  SPLIT_META,
);
