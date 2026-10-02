/** Image formats in words, apart from ./sniff so a page can name a format without the sniffer. */
import type { ImageFormat } from './sniff';

export const FORMAT_LABELS: Record<ImageFormat, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  gif: 'GIF',
  webp: 'WebP',
  avif: 'AVIF',
  heic: 'HEIC',
  bmp: 'BMP',
  tiff: 'TIFF',
};
