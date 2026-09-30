/**
 * `image-geometry` engine: P02 Crop Image and P03 Resize Image. Same checks
 * and worker as `image-codec`; the worker turns, crops and resamples between
 * decoding and encoding (./geometry).
 */
import type { Engine, EngineOutput } from '../types';
import type { Filter, Fit, GeometryJob, Rect, ResizeBy, ResizeSpec } from './geometry';
import {
  baseJob,
  checkImage,
  imageCodecEngine,
  imageOutput,
  type ImageCodecOptions,
  runImageJob,
} from './image-codec';

export interface ImageGeometryOptions extends Pick<
  ImageCodecOptions,
  'format' | 'quality' | 'background' | 'metadata'
> {
  /** P02: the crop box in turned source pixels (one image). */
  crop?: Rect;
  /** P02: clockwise quarter turns. */
  turns?: number;
  flip?: boolean;
  /** P02: free, "4:5", or custom (with ratioW and ratioH). A batch crops to it, centred. */
  ratio?: string;
  ratioW?: string;
  ratioH?: string;
  /** P03: box, width, height, percent, longest, or a preset like "fhd-1920x1080". */
  by?: string;
  width?: string;
  height?: string;
  percent?: string;
  longest?: string;
  /** keep, pad, fill, stretch */
  fit?: string;
  /** white, black, transparent */
  pad?: string;
  /** lanczos, bicubic, bilinear, nearest */
  filter?: string;
}

/** A crop ratio from the options: width / height, or null for Free. */
export function ratioValue(ratio?: string, customW?: string, customH?: string): number | null {
  const parts = ratio === 'custom' ? [customW, customH] : (ratio ?? '').split(':');
  const [w, h] = parts.map(Number);
  return w && h && w > 0 && h > 0 && Number.isFinite(w / h) ? w / h : null;
}

const PADS: Record<string, [number, number, number, number]> = {
  white: [255, 255, 255, 255],
  black: [0, 0, 0, 255],
  transparent: [0, 0, 0, 0],
};
const FILTERS: readonly Filter[] = ['lanczos', 'bicubic', 'bilinear', 'nearest'];
const FITS: readonly Fit[] = ['keep', 'pad', 'fill', 'stretch'];
const BY: readonly ResizeBy[] = ['box', 'width', 'height', 'percent', 'longest'];

/** The resize half of a job, or nothing when the tool doesn't resize. */
export function resizeSpec(opts: ImageGeometryOptions): ResizeSpec | undefined {
  if (!opts.by) return undefined;
  const preset = /(\d+)x(\d+)$/.exec(opts.by);
  const by = preset
    ? 'box'
    : (BY as readonly string[]).includes(opts.by)
      ? (opts.by as ResizeBy)
      : undefined;
  if (!by) return undefined;
  return {
    by,
    width: Number(preset ? preset[1] : opts.width),
    height: Number(preset ? preset[2] : opts.height),
    percent: Number(opts.percent),
    longest: Number(opts.longest),
    fit: (FITS as readonly string[]).includes(opts.fit ?? '') ? (opts.fit as Fit) : 'keep',
    pad: PADS[opts.pad ?? 'white'] ?? PADS.white,
    filter: (FILTERS as readonly string[]).includes(opts.filter ?? '')
      ? (opts.filter as Filter)
      : 'lanczos',
  };
}

export function geometryJob(opts: ImageGeometryOptions): GeometryJob {
  const ratio = ratioValue(opts.ratio, opts.ratioW, opts.ratioH);
  return {
    turns: opts.turns,
    flip: opts.flip,
    crop: opts.crop,
    cropRatio: opts.crop ? undefined : (ratio ?? undefined),
    resize: resizeSpec(opts),
  };
}

export const imageGeometryEngine: Engine<ImageGeometryOptions> = {
  capabilities: (caps) => imageCodecEngine.capabilities(caps),
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 3_000_000) }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const bytes = await input.arrayBuffer();
    const format = checkImage(new Uint8Array(bytes), input.size);
    const done = await runImageJob(
      { ...baseJob(bytes, format, opts), geometry: geometryJob(opts) },
      ctx.signal,
      (fraction, stage) => {
        ctx.progress(fraction, stage);
      },
    );
    return imageOutput(done, format, input.size);
  },
};
