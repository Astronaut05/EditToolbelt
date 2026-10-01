/**
 * P11 Watermark Images (tools/photo.md): a text or logo watermark drawn on
 * each image of a batch in the image worker, then saved in the format
 * picked. The mark's size, margin and offset are shares of each image's
 * width, so photos of different sizes get the same placement. Neither the
 * photos nor the logo leave the browser.
 */
import { ANCHORS, type Anchor } from '@etb/core/watermark';

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
import { FORMAT_LABELS, sniffImage } from './sniff';
import type { WatermarkJob } from './watermark-draw';

export interface WatermarkOptions extends Pick<
  ImageCodecOptions,
  'format' | 'quality' | 'background' | 'metadata'
> {
  /** "text" or "logo". */
  kind?: string;
  text?: string;
  /** Text colour, "#rrggbb". */
  color?: string;
  /** The logo image (the page passes the chosen file). */
  logo?: Blob;
  /** One of the nine spots: tl, t, tr, l, c, r, bl, b, br. */
  position?: string;
  /** Percent of the image's width: the mark, the edge gap, the nudge right and down. */
  size?: string;
  margin?: string;
  offsetX?: string;
  offsetY?: string;
  /** 0-100. */
  opacity?: string;
  /** "on" repeats the mark over the whole image. */
  tile?: string;
}

/** Biggest logo read: a logo is small; this stops a photo being picked by mistake. */
const MAX_LOGO_BYTES = 20 * 1024 * 1024;

const LOGO_FORMATS = new Set(['png', 'webp', 'jpeg']);

/** A number from an option, clamped, or the fallback when it isn't one. */
function numberIn(value: string | undefined, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

/** The worker's watermark from the options, with the logo's bytes read and checked. */
export async function watermarkJob(opts: WatermarkOptions): Promise<WatermarkJob> {
  const anchor = (ANCHORS as readonly string[]).includes(opts.position ?? '')
    ? (opts.position as Anchor)
    : 'br';
  const job: WatermarkJob = {
    color: /^#[0-9a-f]{6}$/i.test(opts.color ?? '') ? (opts.color as string) : '#ffffff',
    anchor,
    size: numberIn(opts.size, 1, 100, 15) / 100,
    margin: numberIn(opts.margin, 0, 25, 2) / 100,
    offsetX: numberIn(opts.offsetX, -50, 50, 0) / 100,
    offsetY: numberIn(opts.offsetY, -50, 50, 0) / 100,
    opacity: numberIn(opts.opacity, 0, 100, 60) / 100,
    tile: opts.tile === 'on',
  };
  if (opts.kind === 'logo') {
    if (!opts.logo) throw new ImageInputError('Choose a logo image.');
    if (opts.logo.size > MAX_LOGO_BYTES) {
      throw new ImageInputError('This logo is over 20 MB. Use a PNG of the logo itself.');
    }
    const logo = await opts.logo.arrayBuffer();
    const format = sniffImage(new Uint8Array(logo));
    if (!format || !LOGO_FORMATS.has(format)) {
      throw new ImageInputError('The logo must be a PNG, WebP or JPG. PNG keeps it see-through.');
    }
    return { ...job, logo };
  }
  const text = (opts.text ?? '').trim();
  if (!text) throw new ImageInputError('Type the watermark text.');
  return { ...job, text };
}

export const watermarkEngine: Engine<WatermarkOptions> = {
  capabilities: (caps) => imageCodecEngine.capabilities(caps),
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 3_000_000) }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const watermark = await watermarkJob(opts);
    const bytes = await input.arrayBuffer();
    const format = checkImage(new Uint8Array(bytes), input.size);
    const done = await runImageJob(
      { ...baseJob(bytes, format, opts), watermark },
      ctx.signal,
      (fraction, stage) => {
        ctx.progress(fraction, stage);
      },
    );
    const ext = OUTPUT_EXT[done.output];
    const percent = (share: number) => `${String(Math.round(share * 100))}%`;
    return {
      blob: new Blob([done.bytes], { type: OUTPUT_MIME[done.output] }),
      ext,
      width: done.width,
      height: done.height,
      path: 'Browser · WASM',
      notes: done.notes,
      nameSuffix: 'watermarked',
      details: [
        { label: 'Watermark', value: watermark.logo ? 'Logo' : `“${watermark.text ?? ''}”` },
        {
          label: 'Size',
          value: watermark.tile
            ? `${percent(watermark.size)} of width, tiled`
            : `${percent(watermark.size)} of width`,
        },
        { label: 'Opacity', value: percent(watermark.opacity) },
        { label: 'Formats', value: `${FORMAT_LABELS[format]} → ${ext.toUpperCase()}` },
        ...(done.quality === undefined ? [] : [{ label: 'Quality', value: String(done.quality) }]),
      ],
    };
  },
};
