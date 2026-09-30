import { describe, expect, it } from 'vitest';

import {
  cleanExif,
  crc32,
  jpegWithExif,
  pngWithExif,
  readJpegExif,
  readPngExif,
  readWebpExif,
  webpWithExif,
} from './exif';
import { sizeChange } from './image-codec';
import { headerSize, sniffImage } from './sniff';

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? Array.from(part, (c) => c.charCodeAt(0)) : part,
    ),
  );

const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/**
 * A little-endian EXIF TIFF block: IFD0 with Make, Orientation 6 and a GPS
 * pointer; a GPS IFD with GPSLatitudeRef "N" and GPSLatitude 41/1, 17/1, 3/1.
 */
function exifWithGps(): Uint8Array {
  const out: number[] = [];
  out.push(...bytes('II'), ...u16le(42), ...u32le(8));
  // IFD0 at 8: 3 entries, then next-IFD 0. Make's value (6 bytes) at 50.
  out.push(...u16le(3));
  out.push(...u16le(0x010f), ...u16le(2), ...u32le(6), ...u32le(50)); // Make
  out.push(...u16le(0x0112), ...u16le(3), ...u32le(1), ...u16le(6), 0, 0); // Orientation 6
  out.push(...u16le(0x8825), ...u16le(4), ...u32le(1), ...u32le(56)); // GPS IFD at 56
  out.push(...u32le(0));
  out.push(...bytes('Canon\0'));
  // GPS IFD at 56: 2 entries, next 0. Latitude (3 rationals, 24 bytes) at 86.
  out.push(...u16le(2));
  out.push(...u16le(0x0001), ...u16le(2), ...u32le(2), ...bytes('N\0'), 0, 0); // GPSLatitudeRef
  out.push(...u16le(0x0002), ...u16le(5), ...u32le(3), ...u32le(86)); // GPSLatitude
  out.push(...u32le(0));
  out.push(...u32le(41), ...u32le(1), ...u32le(17), ...u32le(1), ...u32le(3), ...u32le(1));
  return Uint8Array.from(out);
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

describe('sniffImage (tools/photo.md → validate by magic bytes)', () => {
  it('names each format by its first bytes, not its extension', () => {
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImage(bytes([0x89], 'PNG\r\n', [0x1a, 0x0a]))).toBe('png');
    expect(sniffImage(bytes('GIF89a'))).toBe('gif');
    expect(sniffImage(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('webp');
    expect(sniffImage(bytes('BM'))).toBe('bmp');
    expect(sniffImage(bytes('II*', [0]))).toBe('tiff');
    expect(sniffImage(bytes([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0], 'avifmif1miaf'))).toBe(
      'avif',
    );
    expect(sniffImage(bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0], 'mif1heic'))).toBe('heic');
    expect(sniffImage(bytes('<svg xmlns'))).toBeNull();
  });

  it('reads dimensions from headers', () => {
    const png = bytes([0x89], 'PNG\r\n', [0x1a, 0x0a], u32be(13), 'IHDR', u32be(4000), u32be(3000));
    expect(headerSize(png, 'png')).toEqual({ width: 4000, height: 3000 });
    const gif = bytes('GIF89a', u16le(640), u16le(480));
    expect(headerSize(gif, 'gif')).toEqual({ width: 640, height: 480 });
    // JPEG: SOI, APP0 (length 16), SOF0 with height 3000, width 4000.
    const jpeg = bytes(
      [0xff, 0xd8, 0xff, 0xe0, 0, 16],
      'JFIF\0',
      new Array<number>(9).fill(0),
      [0xff, 0xc0, 0, 17, 8, 0x0b, 0xb8, 0x0f, 0xa0, 3],
    );
    expect(headerSize(jpeg, 'jpeg')).toEqual({ width: 4000, height: 3000 });
    // WebP VP8X: canvas 1920 × 1080 stored minus one, 24-bit little-endian.
    const vp8x = bytes(
      'RIFF',
      [0, 0, 0, 0],
      'WEBPVP8X',
      u32le(10),
      [0, 0, 0, 0],
      [0x7f, 0x07, 0],
      [0x37, 0x04, 0],
    );
    expect(headerSize(vp8x, 'webp')).toEqual({ width: 1920, height: 1080 });
  });
});

describe('EXIF (tools/photo.md → Metadata: strip GPS, keep camera)', () => {
  const latitude = Uint8Array.from([...u32le(41), ...u32le(1), ...u32le(17), ...u32le(1)]);

  it('removes the GPS location and resets orientation, keeping the camera', () => {
    const source = exifWithGps();
    expect(contains(source, latitude)).toBe(true);
    const cleaned = cleanExif(source, { dropGps: true });
    if (!cleaned) throw new Error('unreadable');
    expect(cleaned.hadGps).toBe(true);
    const view = new DataView(cleaned.tiff.buffer);
    expect(view.getUint16(8, true)).toBe(2); // Make and Orientation left
    expect(view.getUint16(10, true)).toBe(0x010f);
    expect(view.getUint16(22, true)).toBe(0x0112);
    expect(view.getUint16(30, true)).toBe(1); // orientation reset
    expect(contains(cleaned.tiff, bytes('Canon'))).toBe(true);
    expect(contains(cleaned.tiff, latitude)).toBe(false);
    expect(contains(cleaned.tiff, Uint8Array.from([0x25, 0x88]))).toBe(false); // no GPS tag
  });

  it('keeps GPS when asked, and refuses what is not TIFF', () => {
    const kept = cleanExif(exifWithGps(), { dropGps: false });
    expect(kept && contains(kept.tiff, latitude)).toBe(true);
    expect(cleanExif(bytes('not tiff at all'), { dropGps: true })).toBeNull();
  });

  it('writes EXIF into a JPEG after JFIF, and reads it back', () => {
    const jpeg = bytes(
      [0xff, 0xd8, 0xff, 0xe0, 0, 16],
      'JFIF\0',
      new Array<number>(9).fill(0),
      [0xff, 0xda, 0, 2, 0xff, 0xd9],
    );
    const tiff = exifWithGps();
    const out = jpegWithExif(jpeg, tiff);
    if (!out) throw new Error('too big');
    expect([...out.subarray(20, 22)]).toEqual([0xff, 0xe1]);
    expect(readJpegExif(out)).toEqual(tiff);
    expect(jpegWithExif(jpeg, new Uint8Array(70_000))).toBeNull();
  });

  it('writes a valid eXIf chunk into a PNG', () => {
    expect(crc32(bytes('IEND'))).toBe(0xae426082);
    const iend = bytes(u32be(0), 'IEND', u32be(0xae426082));
    const idat = bytes(u32be(1), 'IDAT', [0], u32be(crc32(bytes('IDAT', [0]))));
    const png = bytes(
      [0x89],
      'PNG\r\n',
      [0x1a, 0x0a],
      u32be(13),
      'IHDR',
      new Array<number>(17).fill(0),
      [...idat],
      [...iend],
    );
    const tiff = exifWithGps();
    const out = pngWithExif(png, tiff);
    expect(readPngExif(out)).toEqual(tiff);
    const at = 8 + 25;
    expect(String.fromCharCode(...out.subarray(at + 4, at + 8))).toBe('eXIf');
  });

  it('turns a simple WebP into the extended format with an EXIF chunk', () => {
    const vp8l = bytes('VP8L', u32le(5), [0x2f, 0, 0, 0, 0], [0]);
    const webp = bytes('RIFF', u32le(4 + vp8l.length), 'WEBP', [...vp8l]);
    const tiff = exifWithGps();
    const out = webpWithExif(webp, tiff, { width: 1920, height: 1080, alpha: true });
    expect(String.fromCharCode(...out.subarray(12, 16))).toBe('VP8X');
    expect(out[20]).toBe(0x18); // EXIF + alpha flags
    expect(headerSize(out, 'webp')).toEqual({ width: 1920, height: 1080 });
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
    expect(readWebpExif(out)).toEqual(tiff);
  });
});

describe('sizeChange', () => {
  it('reads well for shrinking, growing a little and growing a lot', () => {
    expect(sizeChange(1000, 380)).toBe('−62%');
    expect(sizeChange(1000, 1340)).toBe('+34%');
    expect(sizeChange(1000, 1000)).toBe('+0%');
    expect(sizeChange(33_100, 5_000_000)).toBe('151× larger');
    expect(sizeChange(1000, 2500)).toBe('2.5× larger');
  });
});
