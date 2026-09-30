/**
 * Decoding for the image workers: the browser's own decoders, EXIF
 * orientation applied, with a plain reason when a format isn't supported here.
 */
import type { ImageFormat } from './sniff';

export class ImageReadError extends Error {}

export async function decodeImage(bytes: ArrayBuffer, format: ImageFormat): Promise<ImageBitmap> {
  const blob = new Blob([bytes]);
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
    if (format === 'heic') {
      throw new ImageReadError(
        'This browser can’t open HEIC photos. Safari on a Mac, iPhone or iPad can. On an iPhone you can also set Settings > Camera > Formats to Most Compatible.',
      );
    }
    if (format === 'tiff')
      throw new ImageReadError('This browser can’t open TIFF files. Safari can.');
    throw new ImageReadError('This image couldn’t be read. The file may be damaged or incomplete.');
  }
}
