/**
 * `image-geometry` for P16 Collage Maker (tools/photo.md): 2 to 9 photos,
 * in the order set, each filling its box of a layout template (cropped to
 * fit, centred). The boxes come from @etb/core, in whole pixels; the
 * photos are drawn on a canvas, which the image worker then encodes, the
 * same encoders as every other image tool. Every photo's header is checked
 * first, so one over the 100 MP limit stops the run before any is decoded.
 */
import { collage } from '@etb/core';

import { EngineAbortError } from '../dummy';
import type { Engine, EngineOutput } from '../types';
import { ImageInputError, runImageJob } from './image-codec';
import { checkDecoded, imageHeader } from './image-header';
import { OUTPUT_EXT, OUTPUT_MIME, type OutputFormat } from './protocol';

export interface CollageOptions {
  /** grid, feature, feature-top, columns or rows. */
  template?: string;
  /** An output size id from COLLAGE_SIZES. */
  size?: string;
  /** Px between the photos and around the edge, at the output size. */
  spacing?: string;
  /** Px, each photo's corners. */
  radius?: string;
  /** "#rrggbb", behind the photos. */
  background?: string;
  /** jpeg, png or webp. */
  format?: string;
  /** The photos, in order (the shell's list). */
  files?: Blob[];
}

/** Output sizes: twice the social sizes, so they stay sharp when a platform scales them. */
export const COLLAGE_SIZES: Record<string, { width: number; height: number; label: string }> = {
  square: { width: 2160, height: 2160, label: 'Square' },
  portrait: { width: 2160, height: 2700, label: 'Portrait 4:5' },
  story: { width: 2160, height: 3840, label: 'Story 9:16' },
  landscape: { width: 3840, height: 2160, label: 'Landscape 16:9' },
  a4: { width: 2480, height: 3508, label: 'A4 at 300 dpi' },
};

const FORMATS: readonly OutputFormat[] = ['jpeg', 'png', 'webp'];
const QUALITY = 90;

const templateOf = (value: string | undefined): collage.CollageTemplate =>
  collage.COLLAGE_TEMPLATES.find((t) => t === value) ?? 'grid';

const pixels = (value: string | undefined, fallback: number, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : fallback;
};

const nameOf = (file: Blob, i: number) =>
  file instanceof File ? file.name : `Photo ${String(i + 1)}`;

export const collageEngine: Engine<CollageOptions> = {
  capabilities: () => ({
    supported: typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined',
    reason: 'This browser can’t draw images here. Try a current Chrome, Edge, Safari or Firefox.',
  }),
  estimate: (input, opts) => ({
    seconds: Math.max(1, (opts.files ?? [input]).reduce((sum, f) => sum + f.size, 0) / 15_000_000),
  }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const files = opts.files?.length ? opts.files : [input];
    if (files.length < collage.MIN_PHOTOS || files.length > collage.MAX_PHOTOS) {
      throw new ImageInputError(
        files.length < collage.MIN_PHOTOS
          ? 'Add at least one more photo: a collage takes 2 to 9.'
          : `That’s ${String(files.length)} photos; a collage takes up to ${String(collage.MAX_PHOTOS)}.`,
      );
    }
    const size = COLLAGE_SIZES[opts.size ?? ''] ?? COLLAGE_SIZES.square;
    if (!size) throw new Error('No collage sizes');
    const template = templateOf(opts.template);
    const spacing = pixels(opts.spacing, 24, 400);
    const radius = pixels(opts.radius, 0, 1000);
    const background = /^#[0-9a-f]{6}$/i.test(opts.background ?? '')
      ? (opts.background ?? '#ffffff')
      : '#ffffff';
    let cells: collage.Cell[];
    try {
      cells = collage.collageCells(template, files.length, size.width, size.height, spacing);
    } catch (error) {
      throw new ImageInputError(error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }

    for (const [i, file] of files.entries()) {
      if (ctx.signal.aborted) throw new EngineAbortError();
      await imageHeader(file, nameOf(file, i));
    }

    const canvas = new OffscreenCanvas(size.width, size.height);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('No 2D canvas in this browser');
    g.fillStyle = background;
    g.fillRect(0, 0, size.width, size.height);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    for (const cell of cells) {
      if (ctx.signal.aborted) throw new EngineAbortError();
      const file = files[cell.index] ?? input;
      ctx.progress((cell.index / files.length) * 0.7, 'Placing the photos', {
        step: `${String(cell.index + 1)} of ${String(files.length)}`,
      });
      let bitmap: ImageBitmap;
      try {
        // Upright as the browser shows it: phone photos turned by their EXIF.
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (error) {
        throw new ImageInputError(
          `${nameOf(file, cell.index)} can’t be read in this browser. HEIC opens only in Safari; try JPG, PNG or WebP.`,
          { cause: error },
        );
      }
      try {
        checkDecoded(bitmap.width, bitmap.height, nameOf(file, cell.index));
      } catch (error) {
        bitmap.close();
        throw error;
      }
      const crop = collage.coverCrop(bitmap.width, bitmap.height, cell.width, cell.height);
      g.save();
      if (radius > 0) {
        g.beginPath();
        g.roundRect(
          cell.x,
          cell.y,
          cell.width,
          cell.height,
          Math.min(radius, cell.width / 2, cell.height / 2),
        );
        g.clip();
      }
      g.drawImage(
        bitmap,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        cell.x,
        cell.y,
        cell.width,
        cell.height,
      );
      g.restore();
      bitmap.close();
    }

    // Handed to the image worker losslessly, which writes the format picked.
    const drawn = await canvas.convertToBlob({ type: 'image/png' });
    const output = FORMATS.find((f) => f === opts.format) ?? 'jpeg';
    const done = await runImageJob(
      {
        bytes: await drawn.arrayBuffer(),
        format: 'png',
        output,
        quality: QUALITY,
        background,
        metadata: 'none',
        optimise: false,
      },
      ctx.signal,
      (fraction, stage) => {
        ctx.progress(0.7 + fraction * 0.3, stage);
      },
    );
    ctx.progress(1, 'Done');
    const dims = `${String(size.width)} × ${String(size.height)} px`;
    // Named after the first photo in the order set.
    const first = nameOf(files[0] ?? input, 0);
    const dot = first.lastIndexOf('.');
    const stem = (dot > 0 ? first.slice(0, dot) : first) || 'photos';
    return {
      blob: new Blob([done.bytes], { type: OUTPUT_MIME[done.output] }),
      ext: OUTPUT_EXT[done.output],
      name: `${stem}_collage.${OUTPUT_EXT[done.output]}`,
      width: done.width,
      height: done.height,
      path: 'Browser · WASM',
      notes: [
        `${String(files.length)} photos, ${dims}`,
        output === 'png'
          ? 'PNG, lossless'
          : `${OUTPUT_EXT[output].toUpperCase()}, quality ${String(QUALITY)}`,
      ],
      details: [
        { label: 'Size', value: `${size.label} · ${dims}` },
        { label: 'Spacing', value: `${String(spacing)} px` },
      ],
    };
  },
};
