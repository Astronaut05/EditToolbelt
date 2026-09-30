/**
 * EXIF handling for re-encoded photos (tools/photo.md → Metadata): by default
 * keep camera and copyright data but remove the GPS location; or remove all.
 * Orientation is reset to 1 because decoding already turned the pixels.
 *
 * EXIF is a TIFF structure. We read it from JPEG (APP1), PNG (eXIf) and WebP
 * (EXIF chunk), and write it into JPEG, PNG and WebP. AVIF output gets none.
 */

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"

const TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};
const TAG_ORIENTATION = 0x0112;
const TAG_GPS_IFD = 0x8825;

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

function startsWithExifHeader(bytes: Uint8Array, at: number): boolean {
  return EXIF_HEADER.every((byte, i) => bytes[at + i] === byte);
}

/** The TIFF block of a JPEG's EXIF (APP1) segment, or null. */
export function readJpegExif(jpeg: Uint8Array): Uint8Array | null {
  let i = 2;
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) break; // start of scan, end of image
    const length = ((jpeg[i + 2] ?? 0) << 8) | (jpeg[i + 3] ?? 0);
    if (marker === 0xe1 && startsWithExifHeader(jpeg, i + 4))
      return jpeg.slice(i + 10, i + 2 + length);
    i += 2 + length;
  }
  return null;
}

/** The TIFF block of a PNG eXIf chunk, or null. */
export function readPngExif(png: Uint8Array): Uint8Array | null {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let i = 8;
  while (i + 8 <= png.length) {
    const length = view.getUint32(i);
    const type = ascii(png, i + 4, 4);
    if (type === 'eXIf') return png.slice(i + 8, i + 8 + length);
    if (type === 'IDAT' || type === 'IEND') return null;
    i += 12 + length;
  }
  return null;
}

/** The TIFF block of a WebP EXIF chunk (with or without an "Exif\0\0" prefix), or null. */
export function readWebpExif(webp: Uint8Array): Uint8Array | null {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  let i = 12;
  while (i + 8 <= webp.length) {
    const type = ascii(webp, i, 4);
    const size = view.getUint32(i + 4, true);
    if (type === 'EXIF') {
      const start = startsWithExifHeader(webp, i + 8) ? i + 14 : i + 8;
      return webp.slice(start, i + 8 + size);
    }
    i += 8 + size + (size % 2);
  }
  return null;
}

export interface CleanedExif {
  tiff: Uint8Array;
  hadGps: boolean;
}

/**
 * Sets Orientation to 1 and, with `dropGps`, removes the GPS pointer from
 * IFD0 and zeroes the GPS IFD and its values, so no coordinates remain in the
 * bytes. Returns null when the block isn't a readable TIFF structure.
 */
export function cleanExif(
  source: Uint8Array,
  { dropGps }: { dropGps: boolean },
): CleanedExif | null {
  if (source.length < 8) return null;
  const tiff = source.slice();
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const order = ascii(tiff, 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (at: number) => view.getUint16(at, le);
  const u32 = (at: number) => view.getUint32(at, le);
  if (u16(2) !== 42) return null;
  const inside = (at: number, length: number) => at >= 0 && at + length <= tiff.length;

  const ifd0 = u32(4);
  if (!inside(ifd0, 2)) return null;
  let count = u16(ifd0);
  if (!inside(ifd0 + 2, count * 12 + 4)) return null;

  let hadGps = false;
  for (let n = 0; n < count; n += 1) {
    const entry = ifd0 + 2 + n * 12;
    const tag = u16(entry);
    if (tag === TAG_ORIENTATION && u16(entry + 2) === 3) view.setUint16(entry + 8, 1, le);
    if (tag !== TAG_GPS_IFD) continue;
    hadGps = true;
    if (!dropGps) continue;
    const gps = u32(entry + 8);
    if (inside(gps, 2)) {
      const gpsCount = u16(gps);
      if (inside(gps + 2, gpsCount * 12 + 4)) {
        for (let g = 0; g < gpsCount; g += 1) {
          const gpsEntry = gps + 2 + g * 12;
          const size = (TYPE_SIZES[u16(gpsEntry + 2)] ?? 1) * u32(gpsEntry + 4);
          if (size > 4 && inside(u32(gpsEntry + 8), size))
            tiff.fill(0, u32(gpsEntry + 8), u32(gpsEntry + 8) + size);
        }
        tiff.fill(0, gps, gps + 2 + gpsCount * 12 + 4);
      }
    }
    // Remove the pointer: shift the later entries and the next-IFD offset up by one entry.
    tiff.copyWithin(entry, entry + 12, ifd0 + 2 + count * 12 + 4);
    tiff.fill(0, ifd0 + 2 + (count - 1) * 12 + 4, ifd0 + 2 + count * 12 + 4);
    count -= 1;
    view.setUint16(ifd0, count, le);
    n -= 1;
  }
  return { tiff, hadGps };
}

/** A JPEG with an EXIF APP1 segment right after SOI (and JFIF APP0, if there is one). */
export function jpegWithExif(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array | null {
  const length = 2 + EXIF_HEADER.length + tiff.length;
  if (length > 0xffff) return null; // too big for one segment; rare (huge maker notes)
  let insertAt = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) insertAt = 4 + (((jpeg[4] ?? 0) << 8) | (jpeg[5] ?? 0));
  const segment = new Uint8Array(2 + length);
  segment.set([0xff, 0xe1, length >> 8, length & 0xff, ...EXIF_HEADER]);
  segment.set(tiff, 10);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, insertAt));
  out.set(segment, insertAt);
  out.set(jpeg.subarray(insertAt), insertAt + segment.length);
  return out;
}

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A PNG with an eXIf chunk before the first IDAT. */
export function pngWithExif(png: Uint8Array, tiff: Uint8Array): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  while (at + 8 <= png.length && ascii(png, at + 4, 4) !== 'IDAT') at += 12 + view.getUint32(at);
  const chunk = new Uint8Array(12 + tiff.length);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, tiff.length);
  chunk.set([0x65, 0x58, 0x49, 0x66], 4); // "eXIf"
  chunk.set(tiff, 8);
  chunkView.setUint32(8 + tiff.length, crc32(chunk.subarray(4, 8 + tiff.length)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at));
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length % 2));
  out.set(Array.from(type, (c) => c.charCodeAt(0)));
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

/**
 * A WebP with an EXIF chunk. Simple files (one VP8 or VP8L chunk) become the
 * extended format, which needs a VP8X header with the canvas size.
 */
export function webpWithExif(
  webp: Uint8Array,
  tiff: Uint8Array,
  size: { width: number; height: number; alpha: boolean },
): Uint8Array {
  const first = ascii(webp, 12, 4);
  let body = webp.subarray(12);
  if (first === 'VP8X') {
    body = body.slice();
    body[8] = (body[8] ?? 0) | 0x08; // EXIF present
  } else {
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x08 | (size.alpha ? 0x10 : 0);
    const w = size.width - 1;
    const h = size.height - 1;
    vp8x.set(
      [w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff],
      4,
    );
    const header = riffChunk('VP8X', vp8x);
    const joined = new Uint8Array(header.length + body.length);
    joined.set(header);
    joined.set(body, header.length);
    body = joined;
  }
  const exif = riffChunk('EXIF', tiff);
  const out = new Uint8Array(12 + body.length + exif.length);
  out.set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  out.set(body, 12);
  out.set(exif, 12 + body.length);
  return out;
}
