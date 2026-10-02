/**
 * P16 Collage Maker and P18 Images to PDF take several images and draw
 * them on the main thread. Each is checked from its first bytes before
 * anything decodes it: the format, the 200 MB limit and, where the header
 * says the size, the 100 MP limit (`checkImage`), so a 20000 × 20000 px PNG
 * of a few KB is refused instead of filling the tab's memory.
 */
import { pdf } from '@etb/core';

import { checkImage, IMAGE_LIMITS, ImageInputError } from './image-codec';
import { headerSize, type ImageFormat } from './sniff';

/** Bytes read for the header: a JPEG's size comes after its metadata, rarely this far in. */
const HEAD = 512 * 1024;

export interface ImageHeader {
  format: ImageFormat;
  /** Upright (a JPEG's EXIF orientation applied); null when the header doesn't say (AVIF, HEIC, TIFF). */
  width: number | null;
  height: number | null;
}

/**
 * An image's format and size from its header, the limits checked; throws an
 * ImageInputError (naming the file, given a name) when it's not an image or
 * too big.
 */
export async function imageHeader(file: Blob, name?: string): Promise<ImageHeader> {
  try {
    let bytes = new Uint8Array(await file.slice(0, HEAD).arrayBuffer());
    let format = checkImage(bytes, file.size);
    let size = headerSize(bytes, format);
    if (!size && format === 'jpeg' && file.size > HEAD) {
      // Metadata longer than the head: read on (the bytes only, nothing is decoded).
      bytes = new Uint8Array(await file.arrayBuffer());
      format = checkImage(bytes, file.size);
      size = headerSize(bytes, format);
    }
    if (!size) return { format, width: null, height: null };
    const turned = format === 'jpeg' && (pdf.jpegInfo(bytes)?.orientation ?? 1) >= 5;
    return turned
      ? { format, width: size.height, height: size.width }
      : { format, width: size.width, height: size.height };
  } catch (error) {
    throw name ? named(error, name) : error;
  }
}

/** The 100 MP limit for a decoded image whose header didn't say its size (AVIF, HEIC). */
export function checkDecoded(width: number, height: number, name: string): void {
  if (width * height > IMAGE_LIMITS.maxPixels) {
    const mp = ((width * height) / 1e6).toFixed(0);
    throw new ImageInputError(
      `${name} is ${String(width)} × ${String(height)} px (${mp} MP); the browser limit is 100 MP.`,
    );
  }
}

/** A file's problem with its name in front, for a list of several. */
function named(error: unknown, name: string): unknown {
  if (!(error instanceof ImageInputError)) return error;
  const message = error.message.replace(/^This (?:file|image) is /, `${name} is `);
  return new ImageInputError(message === error.message ? `${name}: ${message}` : message, {
    cause: error,
  });
}
