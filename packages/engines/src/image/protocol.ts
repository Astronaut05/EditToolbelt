/** Messages between the image engines and their worker. */
import type { Lut } from '@etb/core/lut';

import type { GeometryJob } from './geometry';
import type { GridSpec } from './grid';
import type { ImageFormat } from './sniff';
import type { Focus, SocialFit } from './social';

export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'bmp';

export const OUTPUT_EXT: Record<OutputFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  bmp: 'bmp',
};

export const OUTPUT_MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

export interface ImageJob {
  bytes: ArrayBuffer;
  format: ImageFormat;
  output: OutputFormat;
  /** 1-100, for JPG, WebP and AVIF. */
  quality: number;
  /** Fill for transparent pixels in formats without alpha (JPG, and BMP stays with alpha). */
  background: string;
  /** keep: camera and copyright EXIF, no GPS (the default). none: no metadata at all. */
  metadata: 'keep' | 'none';
  /** Scale down so neither side is longer than this. */
  maxSide?: number;
  /** Compress to about this many bytes (JPG, WebP, AVIF): binary search on quality. */
  targetBytes?: number;
  /** PNG: run the lossless optimiser (oxipng). */
  optimise?: boolean;
  /** Return the original file when re-encoding would make it bigger (Compress). */
  neverGrow?: boolean;
  /** Turn, flip, crop, resize (P02 Crop, P03 Resize). */
  geometry?: GeometryJob;
  /** P14: cut into tiles and answer a ZIP of them, named from `stem`. */
  tiles?: GridSpec & { stem: string };
  /** P13: one file per size, or a ZIP of them for two or more. */
  social?: SocialJob;
  /** C05: a LUT applied after any geometry, blended with the original by `intensity` (0-1). */
  lut?: { lut: Lut; intensity: number; label: string };
}

export interface SocialJob {
  sizes: {
    id: string;
    /** "Instagram · Post, square", for the notes. */
    label: string;
    width: number;
    height: number;
    /** Stay under the platform's limit: lower the quality of JPG, WebP and AVIF if needed. */
    maxBytes?: number;
  }[];
  fit: SocialFit;
  focus: Focus;
  /** Fit with colour: "#rrggbb". */
  color: string;
  stem: string;
}

export type WorkerMessage =
  | { type: 'progress'; fraction: number; stage: string }
  | {
      type: 'done';
      bytes: ArrayBuffer;
      width: number;
      height: number;
      output: OutputFormat;
      notes: string[];
      quality?: number;
      /** P13, P14: the bytes are a ZIP of this many images. */
      tiles?: number;
    }
  | { type: 'error'; message: string };
