/**
 * The image engines' worker: decode with the browser (EXIF orientation
 * applied, colours in sRGB), scale, encode with the jSquash WASM codecs, and
 * put back the metadata the user chose. Off the main thread, so the page
 * stays responsive while a 12 MP photo encodes.
 */
import { encodeBmp } from './bmp';
import { applyGeometry, GeometryError } from './geometry';
import {
  cleanExif,
  jpegWithExif,
  pngWithExif,
  readJpegExif,
  readPngExif,
  readWebpExif,
  webpWithExif,
} from './exif';
import { OUTPUT_EXT, type ImageJob, type OutputFormat, type WorkerMessage } from './protocol';
import { FORMAT_LABELS, type ImageFormat } from './sniff';

interface WorkerScope {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ImageJob>) => void) | null;
}
const scope = self as unknown as WorkerScope;

const post = (message: WorkerMessage, transfer: Transferable[] = []) => {
  scope.postMessage(message, transfer);
};

class ReadError extends Error {}

async function decode(job: ImageJob): Promise<ImageBitmap> {
  const blob = new Blob([job.bytes]);
  try {
    try {
      return await createImageBitmap(blob, {
        imageOrientation: 'from-image',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'default',
      });
    } catch (error) {
      // Older engines reject an option value they don't know; the defaults still apply EXIF orientation.
      if (error instanceof TypeError) return await createImageBitmap(blob);
      throw error;
    }
  } catch {
    if (job.format === 'heic') {
      throw new ReadError(
        'This browser can’t open HEIC photos. Safari on a Mac, iPhone or iPad can. On an iPhone you can also set Settings > Camera > Formats to Most Compatible.',
      );
    }
    if (job.format === 'tiff')
      throw new ReadError('This browser can’t open TIFF files. Safari can.');
    throw new ReadError('This image couldn’t be read. The file may be damaged or incomplete.');
  }
}

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
    // Binary search on quality, at most 8 encodes (tools/photo.md → P05).
    let low = 40;
    let high = 95;
    let best: { bytes: ArrayBuffer; quality: number } | null = null;
    for (let step = 0; step < 8 && low <= high; step += 1) {
      const q = Math.round((low + high) / 2);
      const attempt = await encode(image, job.output, q, false);
      post({
        type: 'progress',
        fraction: 0.3 + (0.6 * (step + 1)) / 8,
        stage: `Trying quality ${String(q)}`,
      });
      if (attempt.byteLength <= job.targetBytes) {
        best = { bytes: attempt, quality: q };
        low = q + 1;
      } else {
        high = q - 1;
      }
    }
    if (!best) {
      const floor = await encode(image, job.output, 40, false);
      best = { bytes: floor, quality: 40 };
      if (floor.byteLength > job.targetBytes) {
        notes.push('Still above the target at quality 40. Set a maximum size in px to go smaller.');
      }
    }
    bytes = best.bytes;
    quality = best.quality;
  } else {
    bytes = await encode(image, job.output, quality, job.optimise ?? false);
  }
  post({ type: 'progress', fraction: 0.92, stage: 'Finishing' });

  // Metadata: camera and copyright kept, GPS removed (the default), or nothing.
  const source = new Uint8Array(job.bytes);
  const exif = sourceExif(source, job.format);
  let hadGps = false;
  if (exif) {
    if (job.metadata === 'none') {
      notes.push('All metadata removed');
    } else {
      const cleaned = cleanExif(exif, { dropGps: true });
      if (cleaned) {
        hadGps = cleaned.hadGps;
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
          bytes = withExif.slice().buffer;
          notes.push(hadGps ? 'GPS location removed, camera details kept' : 'Camera details kept');
        } else {
          notes.push(
            `Camera details not kept: ${FORMAT_LABELS[job.format]} to ${OUTPUT_EXT[job.output].toUpperCase()} carries no EXIF here`,
          );
        }
      }
    }
  }

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
          error instanceof ReadError || error instanceof GeometryError
            ? error.message
            : `The image couldn’t be processed: ${error instanceof Error ? error.message : 'unknown error'}`,
      });
    },
  );
};
