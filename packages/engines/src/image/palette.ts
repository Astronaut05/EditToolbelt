/**
 * C01 Color Palette from Image: the image is decoded and scaled down (256 px
 * on its long side is plenty for colour statistics), then @etb/core finds
 * the palette. The download is the palette in the chosen format: CSS
 * variables, JSON, ASE for Adobe apps, or a PNG palette card.
 */
import {
  color,
  extractPalette,
  paletteAse,
  paletteCss,
  paletteJson,
  type PaletteMethod,
  type Swatch,
} from '@etb/core';

import type { Engine, EngineOutput } from '../types';
import { decodeImage, ImageReadError } from './decode';
import { sniffImage } from './sniff';

export interface PaletteEngineOptions {
  /** 3-12 */
  count?: string;
  /** dominant, vibrant or muted */
  method?: string;
  /** on or off */
  extremes?: string;
  /** css, json, ase or png */
  export?: string;
}

export const PALETTE_LIMITS = { maxBytes: 100 * 1024 ** 2 };

const SAMPLE_SIDE = 256;

/** The palette card: one band a colour, its HEX under it. */
async function card(swatches: Swatch[]): Promise<Blob> {
  const band = 160;
  const canvas = new OffscreenCanvas(band * swatches.length, band + 44);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  swatches.forEach((s, i) => {
    ctx.fillStyle = s.hex;
    ctx.fillRect(i * band, 0, band, band);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(s.hex.toUpperCase(), i * band + band / 2, band + 22);
  });
  return canvas.convertToBlob({ type: 'image/png' });
}

export const paletteEngine: Engine<PaletteEngineOptions> = {
  capabilities: () => ({
    supported: typeof OffscreenCanvas === 'function',
    reason:
      'This browser can’t read images here yet. Try a current Chrome, Edge, Safari or Firefox.',
  }),
  estimate: () => ({ seconds: 0.5 }),
  async run(file, opts, ctx): Promise<EngineOutput> {
    if (file.size > PALETTE_LIMITS.maxBytes) {
      throw new ImageReadError('This image is over 100 MB, the limit for this tool.');
    }
    const bytes = await file.arrayBuffer();
    const format = sniffImage(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 64)));
    if (!format) {
      throw new ImageReadError(
        'This isn’t an image this tool can read. Try JPG, PNG, WebP or AVIF.',
      );
    }
    ctx.progress(0.2, 'Reading the image');
    const bitmap = await decodeImage(bytes, format);
    const scale = Math.min(1, SAMPLE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const draw = canvas.getContext('2d', { willReadFrequently: true });
    if (!draw) throw new Error('No 2D canvas');
    // Smooth scaling averages neighbours, like the colour a region reads as.
    draw.imageSmoothingQuality = 'high';
    draw.drawImage(bitmap, 0, 0, width, height);
    const original = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    ctx.progress(0.5, 'Finding the colours');
    const count = Math.min(12, Math.max(3, Number(opts.count) || 6));
    const method: PaletteMethod =
      opts.method === 'vibrant' || opts.method === 'muted' ? opts.method : 'dominant';
    const swatches = extractPalette(draw.getImageData(0, 0, width, height).data, {
      count,
      method,
      ignoreExtremes: opts.extremes !== 'off',
    });
    if (swatches.length === 0) {
      throw new ImageReadError(
        'This image has no visible pixels, so there are no colours to find.',
      );
    }
    const kind = opts.export ?? 'css';
    const blob =
      kind === 'png'
        ? await card(swatches)
        : kind === 'ase'
          ? new Blob([paletteAse(swatches)], { type: 'application/octet-stream' })
          : kind === 'json'
            ? new Blob([paletteJson(swatches)], { type: 'application/json' })
            : new Blob([paletteCss(swatches)], { type: 'text/css' });
    return {
      blob,
      ext: kind === 'png' || kind === 'ase' || kind === 'json' ? kind : 'css',
      width: original.width,
      height: original.height,
      path: 'Browser',
      notes: [
        ...(swatches.length < count
          ? [
              `Only ${String(swatches.length)} distinct colours in this image, so the palette has ${String(swatches.length)}`,
            ]
          : []),
        ...(opts.extremes !== 'off' ? ['Near-white and near-black left out'] : []),
      ],
      swatches: swatches.map((s) => {
        const f = color.formats(s.rgb);
        return { hex: s.hex, rgb: f.rgb, hsl: f.hsl, share: s.share };
      }),
    };
  },
};
