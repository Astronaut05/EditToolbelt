/**
 * Image formats by their magic bytes (tools/photo.md → "Validate by magic
 * bytes"), and pixel dimensions read from the header, so the 100 MP limit is
 * checked before anything is decoded.
 */

export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'heic' | 'bmp' | 'tiff';

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

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

export function sniffImage(bytes: Uint8Array): ImageFormat | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (ascii(bytes, 0, 4) === 'GIF8') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 2) === 'BM') return 'bmp';
  if (ascii(bytes, 0, 4) === 'II*\0' || ascii(bytes, 0, 4) === 'MM\0*') return 'tiff';
  if (ascii(bytes, 4, 4) === 'ftyp') {
    // The major brand, then the compatible brands, name the format.
    const size = Math.min(
      bytes.length,
      (bytes[0] ?? 0) * 2 ** 24 +
        ((bytes[1] ?? 0) << 16) +
        ((bytes[2] ?? 0) << 8) +
        (bytes[3] ?? 0),
    );
    const brands: string[] = [ascii(bytes, 8, 4)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(bytes, i, 4));
    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'avif';
    if (
      brands.some((brand) =>
        ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand),
      )
    ) {
      return 'heic';
    }
  }
  return null;
}

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 65536 + u16be(b, i + 2);
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number) => u16le(b, i) + (b[i + 2] ?? 0) * 65536;
const i32le = (b: Uint8Array, i: number) =>
  u16le(b, i) + ((b[i + 2] ?? 0) << 16) + ((b[i + 3] ?? 0) << 24);

/** Width and height from the header, or null when the format needs a decode to tell. */
export function headerSize(
  bytes: Uint8Array,
  format: ImageFormat,
): { width: number; height: number } | null {
  switch (format) {
    case 'png':
      return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
    case 'gif':
      return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
    case 'bmp':
      return { width: Math.abs(i32le(bytes, 18)), height: Math.abs(i32le(bytes, 22)) };
    case 'webp': {
      const chunk = ascii(bytes, 12, 4);
      if (chunk === 'VP8X') return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
      if (chunk === 'VP8L') {
        const bits =
          (bytes[21] ?? 0) |
          ((bytes[22] ?? 0) << 8) |
          ((bytes[23] ?? 0) << 16) |
          ((bytes[24] ?? 0) << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8 ')
        return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
      return null;
    }
    case 'jpeg': {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1] ?? 0;
        // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          return { width: u16be(bytes, i + 7), height: u16be(bytes, i + 5) };
        }
        i += 2 + u16be(bytes, i + 2);
      }
      return null;
    }
    default:
      return null;
  }
}
