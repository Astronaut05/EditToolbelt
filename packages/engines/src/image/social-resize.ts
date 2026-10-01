/**
 * `image-geometry` for P13 Social Media Image Resizer (tools/photo.md): one
 * image in, every picked platform size out, from a single decode in the
 * image worker. One size downloads as the image; two or more as a ZIP.
 */
import { socialLabel, socialPresetsOf } from '@etb/core';

import { safeStem } from '../names';
import type { Engine, EngineOutput } from '../types';
import {
  baseJob,
  checkImage,
  imageCodecEngine,
  ImageInputError,
  type ImageCodecOptions,
  runImageJob,
} from './image-codec';
import { OUTPUT_EXT, OUTPUT_MIME } from './protocol';
import { FORMAT_LABELS } from './sniff';
import { focusOf, type SocialFit } from './social';

export interface SocialResizeOptions extends Pick<
  ImageCodecOptions,
  'format' | 'quality' | 'background' | 'metadata'
> {
  /** Size ids from the presets table, comma-separated. */
  sizes?: string;
  /** fill, blur or color. */
  fit?: string;
  /** Fit with colour: "#rrggbb". */
  color?: string;
  /** The focal point for Fill: "x,y" as shares of the width and height. */
  focus?: string;
}

const FITS: readonly SocialFit[] = ['fill', 'blur', 'color'];

export const fitOf = (value: string | undefined): SocialFit =>
  FITS.find((fit) => fit === value) ?? 'fill';

const FIT_LABELS: Record<SocialFit, string> = {
  fill: 'Fill and crop',
  blur: 'Fit on blur',
  color: 'Fit on color',
};

export const socialResizeEngine: Engine<SocialResizeOptions> = {
  capabilities: (caps) => imageCodecEngine.capabilities(caps),
  estimate: (input, opts) => ({
    seconds: Math.max(0.5, (input.size / 3_000_000) * (1 + socialPresetsOf(opts.sizes).length)),
  }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const sizes = socialPresetsOf(opts.sizes);
    if (sizes.length === 0) throw new ImageInputError('Pick at least one size');
    const bytes = await input.arrayBuffer();
    const format = checkImage(new Uint8Array(bytes), input.size);
    const fit = fitOf(opts.fit);
    const job = baseJob(bytes, format, opts);
    const done = await runImageJob(
      {
        ...job,
        // Several sizes skip PNG's slow lossless pass, as tiles do.
        optimise: job.optimise && sizes.length === 1,
        social: {
          sizes: sizes.map((size) => ({
            id: size.id,
            label: socialLabel(size),
            width: size.width,
            height: size.height,
            maxBytes: size.maxBytes,
          })),
          fit,
          focus: focusOf(opts.focus),
          color: /^#[0-9a-f]{6}$/i.test(opts.color ?? '') ? (opts.color ?? '') : '#ffffff',
          stem: safeStem(input instanceof File ? input.name : 'image', 'image'),
        },
      },
      ctx.signal,
      (fraction, stage) => {
        ctx.progress(fraction, stage);
      },
    );
    const ext = OUTPUT_EXT[done.output];
    const formats = `${FORMAT_LABELS[format]} → ${ext.toUpperCase()}`;
    const [first] = sizes;
    if (done.tiles === undefined && first) {
      return {
        blob: new Blob([done.bytes], { type: OUTPUT_MIME[done.output] }),
        ext,
        width: done.width,
        height: done.height,
        path: 'Browser · WASM',
        notes: [...done.notes, ...(first.note ? [`${socialLabel(first)}: ${first.note}`] : [])],
        nameSuffix: `${first.id}-${String(first.width)}x${String(first.height)}`,
        details: [
          { label: 'Size', value: socialLabel(first) },
          { label: 'Fit', value: FIT_LABELS[fit] },
          { label: 'Formats', value: formats },
          ...(done.quality === undefined
            ? []
            : [{ label: 'Quality', value: `Quality ${String(done.quality)}` }]),
        ],
      };
    }
    return {
      blob: new Blob([done.bytes], { type: 'application/zip' }),
      ext: 'zip',
      path: 'Browser · WASM',
      notes: [
        ...done.notes,
        ...sizes.flatMap((size) => (size.note ? [`${socialLabel(size)}: ${size.note}`] : [])),
      ],
      details: [
        { label: 'Sizes', value: String(done.tiles ?? sizes.length) },
        { label: 'Fit', value: FIT_LABELS[fit] },
        { label: 'Formats', value: formats },
      ],
    };
  },
};
