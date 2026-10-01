/**
 * `image-geometry` engine: P02 Crop Image, P03 Resize Image and P04 Rotate &
 * Flip. Same checks and worker as `image-codec`; the worker turns, flips,
 * straightens, crops and resamples between decoding and encoding (./geometry).
 */
import type { Engine, EngineOutput } from '../types';
import type { Mark } from './annotate';
import { renderTextOverlay, type TextLayer } from './text-layer';
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
  /** P02, P04: clockwise quarter turns, from the editor. */
  turns?: number;
  flip?: boolean;
  /** P04, from the editor: mirror top to bottom, and a free angle in degrees. */
  flipV?: boolean;
  angle?: number;
  /** P04, a batch: "90", "180" or "270" clockwise, and "horizontal" or "vertical". */
  rotateAll?: string;
  flipAll?: string;
  /** P04: "crop" (auto-crop) or "expand" for a free angle. */
  angleFit?: string;
  /** P04: what shows around an expanded canvas: transparent, white, black. */
  canvas?: string;
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
  /** P09: marks from the editor, in the image's own pixels, drawn before the geometry. */
  marks?: Mark[];
  /** P10: text layers from the editor, and the image's size as the editor saw it (orientation applied). */
  texts?: TextLayer[];
  natural?: { width: number; height: number };
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

/** A preset's box from its value: "fhd-1920x1080" → 1920 × 1080. Split, not a regex, to stay linear. */
function presetBox(value: string): [string, string, string] | null {
  const parts = value.slice(value.lastIndexOf('-') + 1).split('x');
  const [w, h] = parts;
  return parts.length === 2 && w && h && /^\d{1,5}$/.test(w) && /^\d{1,5}$/.test(h)
    ? [value, w, h]
    : null;
}

/** The resize half of a job, or nothing when the tool doesn't resize. */
export function resizeSpec(opts: ImageGeometryOptions): ResizeSpec | undefined {
  if (!opts.by) return undefined;
  const preset = presetBox(opts.by);
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
  // A batch has no editor: its turn and flip come from the options.
  const all = Number(opts.rotateAll);
  return {
    turns: opts.turns ?? (Number.isFinite(all) && all % 90 === 0 ? all / 90 : undefined),
    flip: opts.flip ?? opts.flipAll === 'horizontal',
    flipVertical: opts.flipV ?? opts.flipAll === 'vertical',
    angle: opts.angle,
    angleFit: opts.angleFit === 'expand' ? 'expand' : 'crop',
    fill: PADS[opts.canvas ?? 'transparent'] ?? PADS.transparent,
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
      {
        ...baseJob(bytes, format, opts),
        geometry: geometryJob(opts),
        marks: opts.marks,
        // Text is laid out here, where the page's fonts are, at full size, and laid over in the worker.
        ...(opts.texts &&
          opts.texts.length > 0 &&
          opts.natural && {
            overlay: await renderTextOverlay(opts.texts, opts.natural.width, opts.natural.height),
          }),
      },
      ctx.signal,
      (fraction, stage) => {
        ctx.progress(fraction, stage);
      },
    );
    return imageOutput(done, format, input.size);
  },
};
