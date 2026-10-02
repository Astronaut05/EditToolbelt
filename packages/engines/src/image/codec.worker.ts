/**
 * The image engines' worker: decode with the browser (EXIF orientation
 * applied, colours in sRGB), scale, encode with the jSquash WASM codecs, and
 * put back the metadata the user chose. Off the main thread, so the page
 * stays responsive while a 12 MP photo encodes.
 */
import { applyLut } from '@etb/core/lut';

import { encodeBmp } from './bmp';
import { decodeImage, ImageReadError } from './decode';
import { zipSync } from 'fflate';

import { applyGeometry, cropPixels, GeometryError } from './geometry';
import { GridError, gridTiles, tileName } from './grid';
import {
  cleanExif,
  jpegWithExif,
  pngWithExif,
  readJpegExif,
  readPngExif,
  readWebpExif,
  webpWithExif,
} from './exif';
import {
  OUTPUT_EXT,
  type ImageJob,
  type OutputFormat,
  type SocialJob,
  type WorkerMessage,
} from './protocol';
import { FORMAT_LABELS, type ImageFormat } from './sniff';
import { enlargement, rgbaOf, socialFrame } from './social';

interface WorkerScope {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ImageJob>) => void) | null;
}
const scope = self as unknown as WorkerScope;

const post = (message: WorkerMessage, transfer: Transferable[] = []) => {
  scope.postMessage(message, transfer);
};

const decode = (job: ImageJob) => decodeImage(job.bytes, job.format);

function rgba(bitmap: ImageBitmap, width: number, height: number): ImageData {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas in this browser');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function hasAlpha(image: ImageData): boolean {
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 255) return true;
  return false;
}

/** Composites onto a solid colour, for formats without transparency. */
function flatten(image: ImageData, hex: string): ImageData {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const out = new ImageData(image.width, image.height);
  const src = image.data;
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    const a = (src[i + 3] ?? 255) / 255;
    dst[i] = (src[i] ?? 0) * a + r * (1 - a);
    dst[i + 1] = (src[i + 1] ?? 0) * a + g * (1 - a);
    dst[i + 2] = (src[i + 2] ?? 0) * a + b * (1 - a);
    dst[i + 3] = 255;
  }
  return out;
}

/** AVIF's quality scale sits lower than JPEG's: AVIF 55 looks about like JPEG 80. */
const avifQuality = (quality: number) => Math.max(1, Math.round(quality - 25));

async function encode(
  image: ImageData,
  output: OutputFormat,
  quality: number,
  optimise: boolean,
): Promise<ArrayBuffer> {
  switch (output) {
    case 'jpeg': {
      const { default: encodeJpeg } = await import('@jsquash/jpeg/encode');
      return encodeJpeg(image, { quality });
    }
    case 'webp': {
      const { default: encodeWebp } = await import('@jsquash/webp/encode');
      return encodeWebp(image, { quality });
    }
    case 'avif': {
      const { encodeAvif } = await import('./codecs');
      return encodeAvif(image, avifQuality(quality));
    }
    case 'png': {
      const { default: encodePng } = await import('@jsquash/png/encode');
      const png = await encodePng(image);
      if (!optimise) return png;
      const { optimisePng } = await import('./codecs');
      return optimisePng(png);
    }
    case 'bmp':
      return encodeBmp(image.data, image.width, image.height).buffer;
  }
}

/**
 * The best quality that lands at or under `target` bytes (JPG, WebP, AVIF):
 * a binary search on quality, at most 8 encodes (tools/photo.md → P05). At
 * the floor (40, or the ceiling if that's lower) it answers what it has,
 * even if that's still over.
 */
async function encodeUnder(
  image: ImageData,
  output: OutputFormat,
  target: number,
  onStep: (step: number, quality: number) => void = () => undefined,
  ceiling = 95,
): Promise<{ bytes: ArrayBuffer; quality: number }> {
  const floor = Math.min(40, ceiling);
  let low = floor;
  let high = ceiling;
  let best: { bytes: ArrayBuffer; quality: number } | null = null;
  for (let step = 0; step < 8 && low <= high; step += 1) {
    const q = Math.round((low + high) / 2);
    const attempt = await encode(image, output, q, false);
    onStep(step, q);
    if (attempt.byteLength <= target) {
      best = { bytes: attempt, quality: q };
      low = q + 1;
    } else {
      high = q - 1;
    }
  }
  return best ?? { bytes: await encode(image, output, floor, false), quality: floor };
}

function sourceExif(bytes: Uint8Array, format: ImageFormat): Uint8Array | null {
  if (format === 'jpeg') return readJpegExif(bytes);
  if (format === 'png') return readPngExif(bytes);
  if (format === 'webp') return readWebpExif(bytes);
  return null;
}

const LOSSY: readonly OutputFormat[] = ['jpeg', 'webp', 'avif'];

/** The output format a source keeps under "Keep format". */
const SAME_FORMAT: Partial<Record<ImageFormat, OutputFormat>> = {
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  bmp: 'bmp',
};

/**
 * Puts back the metadata the person chose: camera and copyright without GPS
 * (the default), or nothing. Answers the bytes and whether there was GPS.
 */
function withMetadata(
  bytes: ArrayBuffer,
  image: ImageData,
  job: ImageJob,
  exif: Uint8Array | null,
  notes: string[],
): { bytes: ArrayBuffer; hadGps: boolean } {
  if (!exif) return { bytes, hadGps: false };
  if (job.metadata === 'none') {
    notes.push('All metadata removed');
    return { bytes, hadGps: false };
  }
  const cleaned = cleanExif(exif, { dropGps: true });
  if (!cleaned) return { bytes, hadGps: false };
  let withExif: Uint8Array | null = null;
  const out = new Uint8Array(bytes);
  if (job.output === 'jpeg') withExif = jpegWithExif(out, cleaned.tiff);
  if (job.output === 'png') withExif = pngWithExif(out, cleaned.tiff);
  if (job.output === 'webp')
    withExif = webpWithExif(out, cleaned.tiff, {
      width: image.width,
      height: image.height,
      alpha: hasAlpha(image),
    });
  if (withExif) {
    notes.push(
      cleaned.hadGps ? 'GPS location removed, camera details kept' : 'Camera details kept',
    );
    return { bytes: withExif.slice().buffer, hadGps: cleaned.hadGps };
  }
  notes.push(
    `Camera details not kept: ${FORMAT_LABELS[job.format]} to ${OUTPUT_EXT[job.output].toUpperCase()} carries no EXIF here`,
  );
  return { bytes, hadGps: cleaned.hadGps };
}

/** P14: every tile cropped, encoded and given its metadata, in one ZIP (stored: images don't shrink). */
async function runTiles(
  job: ImageJob & { tiles: NonNullable<ImageJob['tiles']> },
  image: ImageData,
  notes: string[],
): Promise<Extract<WorkerMessage, { type: 'done' }>> {
  const tiles = gridTiles(image, job.tiles);
  const exif = sourceExif(new Uint8Array(job.bytes), job.format);
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  const tileNotes: string[] = [];
  for (const [index, tile] of tiles.entries()) {
    post({
      type: 'progress',
      fraction: 0.3 + (0.6 * index) / tiles.length,
      stage: `Tile ${String(index + 1)} of ${String(tiles.length)}`,
    });
    const cut = cropPixels(image, tile);
    let piece = new ImageData(new Uint8ClampedArray(cut.data), cut.width, cut.height);
    if (job.output === 'jpeg' && hasAlpha(piece)) piece = flatten(piece, job.background);
    const encoded = await encode(piece, job.output, job.quality, job.optimise ?? false);
    const done = withMetadata(encoded, piece, job, exif, index === 0 ? tileNotes : []);
    entries[tileName(job.tiles.stem, tile, tiles.length, OUTPUT_EXT[job.output])] = [
      new Uint8Array(done.bytes),
      { level: 0 },
    ];
  }
  post({ type: 'progress', fraction: 0.95, stage: 'Packing the ZIP' });
  const first = tiles[0];
  const sizes = new Set(tiles.map((t) => `${String(t.width)} × ${String(t.height)}`));
  notes.push(
    sizes.size === 1
      ? `${String(tiles.length)} tiles of ${[...sizes][0] ?? ''} px`
      : `${String(tiles.length)} tiles, ${[...sizes].join(' or ')} px`,
    job.tiles.order === 'posting'
      ? 'Numbered in posting order: post 1 first, and the grid reads right on a profile'
      : 'Numbered left to right, top to bottom',
    ...tileNotes,
  );
  const zip = zipSync(entries);
  return {
    type: 'done',
    bytes: zip.slice().buffer,
    width: first?.width ?? 0,
    height: first?.height ?? 0,
    output: job.output,
    notes,
    quality: LOSSY.includes(job.output) ? job.quality : undefined,
    tiles: tiles.length,
  };
}

const MB = (bytes: number) => `${String(Math.round(bytes / 100_000) / 10)} MB`;

/**
 * P13: each size made from the one decode, encoded under the platform's
 * limit where it has one, with the metadata the person chose. One size is
 * answered as that image; more as a ZIP (stored: images don't shrink).
 */
async function runSocial(
  job: ImageJob & { social: SocialJob },
  image: ImageData,
  notes: string[],
): Promise<Extract<WorkerMessage, { type: 'done' }>> {
  const { sizes, fit, focus, stem } = job.social;
  const exif = sourceExif(new Uint8Array(job.bytes), job.format);
  const color = rgbaOf(job.social.color);
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  const sizeNotes: string[] = [];
  const metaNotes: string[] = [];
  let last: { bytes: ArrayBuffer; width: number; height: number; quality: number } | null = null;
  for (const [index, size] of sizes.entries()) {
    post({
      type: 'progress',
      fraction: 0.2 + (0.7 * index) / sizes.length,
      stage: `${size.label}, ${String(index + 1)} of ${String(sizes.length)}`,
    });
    const target = { width: size.width, height: size.height };
    const frame = socialFrame(image, target, { fit, focus, color });
    let piece = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
    if (job.output === 'jpeg' && hasAlpha(piece)) piece = flatten(piece, job.background);
    const enlarged = enlargement(image, target, fit);
    if (enlarged > 1.05) {
      sizeNotes.push(
        `${size.label}: enlarged ${enlarged.toFixed(1)}× from a smaller image, so it may look soft`,
      );
    }
    let quality = job.quality;
    let bytes = await encode(piece, job.output, quality, job.optimise ?? false);
    // EXIF goes back in after the encode: leave room for it under the limit.
    const limit = size.maxBytes && size.maxBytes - (exif?.byteLength ?? 0) - 1024;
    if (limit && bytes.byteLength > limit) {
      if (LOSSY.includes(job.output)) {
        const under = await encodeUnder(piece, job.output, limit, undefined, quality - 1);
        bytes = under.bytes;
        quality = under.quality;
        sizeNotes.push(
          bytes.byteLength > limit
            ? `${size.label}: still over the ${MB(size.maxBytes ?? 0)} limit at quality ${String(quality)}`
            : `${size.label}: quality ${String(quality)} to stay under the ${MB(size.maxBytes ?? 0)} limit`,
        );
      } else {
        sizeNotes.push(
          `${size.label}: ${MB(bytes.byteLength)} is over the ${MB(size.maxBytes ?? 0)} limit. Choose JPG or WebP.`,
        );
      }
    }
    const done = withMetadata(bytes, piece, job, exif, index === 0 ? metaNotes : []);
    last = { bytes: done.bytes, width: piece.width, height: piece.height, quality };
    entries[
      `${stem}-${size.id}-${String(size.width)}x${String(size.height)}.${OUTPUT_EXT[job.output]}`
    ] = [new Uint8Array(done.bytes), { level: 0 }];
  }
  if (!last) throw new Error('No sizes picked');
  notes.push(
    fit === 'fill'
      ? 'Filled and cropped around the focal point'
      : fit === 'blur'
        ? 'The whole image, on a blurred copy of itself'
        : `The whole image, on ${job.social.color.toUpperCase()}`,
    ...sizeNotes,
    ...metaNotes,
  );
  if (sizes.length === 1) {
    return {
      type: 'done',
      bytes: last.bytes,
      width: last.width,
      height: last.height,
      output: job.output,
      notes,
      quality: LOSSY.includes(job.output) ? last.quality : undefined,
    };
  }
  post({ type: 'progress', fraction: 0.95, stage: 'Packing the ZIP' });
  const zip = zipSync(entries);
  return {
    type: 'done',
    bytes: zip.slice().buffer,
    width: last.width,
    height: last.height,
    output: job.output,
    notes,
    quality: LOSSY.includes(job.output) ? job.quality : undefined,
    tiles: sizes.length,
  };
}

async function run(job: ImageJob): Promise<Extract<WorkerMessage, { type: 'done' }>> {
  const notes: string[] = [];
  post({ type: 'progress', fraction: 0.1, stage: 'Reading' });
  const bitmap = await decode(job);
  const scale = job.maxSide ? Math.min(1, job.maxSide / Math.max(bitmap.width, bitmap.height)) : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  if (scale < 1) notes.push(`Scaled down to ${String(width)} × ${String(height)} px`);
  let image = rgba(bitmap, width, height);
  bitmap.close();
  if (job.geometry) {
    post({ type: 'progress', fraction: 0.2, stage: job.geometry.resize ? 'Resizing' : 'Cropping' });
    const done = applyGeometry(image, job.geometry);
    image = new ImageData(done.image.data, done.image.width, done.image.height);
    notes.push(...done.notes);
  }
  if (job.lut) {
    post({ type: 'progress', fraction: 0.25, stage: 'Applying the LUT' });
    applyLut(image.data, job.lut.lut, job.lut.intensity);
    notes.push(`${job.lut.label} applied at ${String(Math.round(job.lut.intensity * 100))}%`);
  }
  if (job.tiles) return runTiles({ ...job, tiles: job.tiles }, image, notes);
  if (job.social) return runSocial({ ...job, social: job.social }, image, notes);

  if ((job.output === 'jpeg' || job.output === 'bmp') && hasAlpha(image)) {
    if (job.output === 'jpeg') {
      image = flatten(image, job.background);
      notes.push(
        `Transparent areas filled with ${job.background.toUpperCase()}: JPG has no transparency`,
      );
    }
  }

  post({ type: 'progress', fraction: 0.3, stage: 'Encoding' });
  let quality = job.quality;
  let bytes: ArrayBuffer;
  if (job.targetBytes && LOSSY.includes(job.output)) {
    const best = await encodeUnder(image, job.output, job.targetBytes, (step, q) => {
      post({
        type: 'progress',
        fraction: 0.3 + (0.6 * (step + 1)) / 8,
        stage: `Trying quality ${String(q)}`,
      });
    });
    if (best.bytes.byteLength > job.targetBytes) {
      notes.push('Still above the target at quality 40. Set a maximum size in px to go smaller.');
    }
    bytes = best.bytes;
    quality = best.quality;
  } else {
    bytes = await encode(image, job.output, quality, job.optimise ?? false);
  }
  post({ type: 'progress', fraction: 0.92, stage: 'Finishing' });

  // Metadata: camera and copyright kept, GPS removed (the default), or nothing.
  const kept = withMetadata(
    bytes,
    image,
    job,
    sourceExif(new Uint8Array(job.bytes), job.format),
    notes,
  );
  bytes = kept.bytes;
  const hadGps = kept.hadGps;

  // Compress never hands back a bigger file of the same format (tools/photo.md → P05).
  const unchanged = scale === 1 && !job.geometry && SAME_FORMAT[job.format] === job.output;
  if (
    job.neverGrow &&
    unchanged &&
    bytes.byteLength >= job.bytes.byteLength &&
    job.metadata === 'keep' &&
    !hadGps
  ) {
    notes.push('Already as small as this format gets: this is your original file');
    return { type: 'done', bytes: job.bytes, width, height, output: job.output, notes };
  }
  return {
    type: 'done',
    bytes,
    width: image.width,
    height: image.height,
    output: job.output,
    notes,
    quality: LOSSY.includes(job.output) ? quality : undefined,
  };
}

scope.onmessage = (event) => {
  run(event.data).then(
    (done) => {
      post(done, [done.bytes]);
    },
    (error: unknown) => {
      post({
        type: 'error',
        message:
          error instanceof ImageReadError ||
          error instanceof GeometryError ||
          error instanceof GridError
            ? error.message
            : `The image couldn’t be processed: ${error instanceof Error ? error.message : 'unknown error'}`,
      });
    },
  );
};
