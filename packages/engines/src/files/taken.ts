/**
 * When a photo or clip was taken, for U02's date rule: EXIF's
 * DateTimeOriginal in JPEG, PNG, WebP and TIFF (as the camera wrote it, a
 * local time), or the creation time in an MP4 or MOV's movie header (UTC).
 * Only the bytes that hold it are read, so a folder of large clips is quick.
 */
import { readJpegExif, readPngExif, readWebpExif } from '../image/exif';
import { readTiff } from '../image/tiff';

const TAG_DATE_TIME = 0x0132;
const TAG_DATE_TIME_ORIGINAL = 0x9003;

/** Seconds from 1904-01-01 (QuickTime's epoch) to 1970-01-01. */
const QUICKTIME_EPOCH = 2_082_844_800;

const bytesOf = async (blob: Blob, start = 0, end = blob.size) =>
  new Uint8Array(await blob.slice(start, Math.min(end, blob.size)).arrayBuffer());

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/** "2025:07:14 09:30:15" as a local time, or undefined. */
export function exifDate(text: string): Date | undefined {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text.trim());
  if (!match) return undefined;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return new Date(y, mo - 1, d, h, mi, s);
}

/** The date in an EXIF TIFF block: when it was taken, else when it was last saved by the camera. */
export function tiffDate(tiff: Uint8Array): Date | undefined {
  const block = readTiff(tiff);
  if (!block) return undefined;
  const text = (tag: number) => {
    const entry = block.entries.find((e) => e.tag === tag && e.type === 2);
    if (!entry) return '';
    const value = String.fromCharCode(...entry.value);
    // The field is padded with NULs: trimmed by a loop, not a regex that backtracks.
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 0) end -= 1;
    return value.slice(0, end);
  };
  return exifDate(text(TAG_DATE_TIME_ORIGINAL)) ?? exifDate(text(TAG_DATE_TIME));
}

/** An MP4 or MOV's creation time, from `moov/mvhd`, walking boxes by their sizes. */
async function movieDate(file: Blob): Promise<Date | undefined> {
  let at = 0;
  for (let boxes = 0; at + 8 <= file.size && boxes < 64; boxes += 1) {
    const head = await bytesOf(file, at, at + 16);
    const view = new DataView(head.buffer);
    let size = view.getUint32(0);
    const type = ascii(head, 4, 4);
    let header = 8;
    if (size === 1 && head.length >= 16) {
      size = Number(view.getBigUint64(8));
      header = 16;
    } else if (size === 0) size = file.size - at;
    if (size < header) return undefined;
    if (type === 'moov') {
      const moov = await bytesOf(file, at + header, at + Math.min(size, 4 * 1024 * 1024));
      const mv = new DataView(moov.buffer);
      for (let i = 0; i + 8 <= moov.length;) {
        const childSize = mv.getUint32(i);
        if (ascii(moov, i + 4, 4) === 'mvhd' && i + 20 <= moov.length) {
          const version = moov[i + 8];
          const seconds = version === 1 ? Number(mv.getBigUint64(i + 12)) : mv.getUint32(i + 12);
          // 0 means "not set"; some cameras write that.
          return seconds > QUICKTIME_EPOCH
            ? new Date((seconds - QUICKTIME_EPOCH) * 1000)
            : undefined;
        }
        if (childSize < 8) return undefined;
        i += childSize;
      }
      return undefined;
    }
    at += size;
  }
  return undefined;
}

/** When the file was taken, if it says. Never throws: an unreadable file has no date. */
export async function takenDate(file: Blob): Promise<Date | undefined> {
  try {
    const head = await bytesOf(file, 0, 16);
    if (head[0] === 0xff && head[1] === 0xd8) {
      const exif = readJpegExif(await bytesOf(file, 0, 256 * 1024));
      return exif ? tiffDate(exif) : undefined;
    }
    if (head[0] === 0x89 && ascii(head, 1, 3) === 'PNG') {
      const exif = readPngExif(await bytesOf(file, 0, 1024 * 1024));
      return exif ? tiffDate(exif) : undefined;
    }
    if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
      const exif = readWebpExif(await bytesOf(file));
      return exif ? tiffDate(exif) : undefined;
    }
    if (ascii(head, 0, 4) === 'II*\0' || ascii(head, 0, 4) === 'MM\0*') {
      return tiffDate(await bytesOf(file, 0, 64 * 1024 * 1024));
    }
    if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(head, 4, 4))) {
      return await movieDate(file);
    }
  } catch {
    // Not a file we can read a date from.
  }
  return undefined;
}
