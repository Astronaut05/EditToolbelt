import { describe, expect, it } from 'vitest';

import { exifDate, takenDate } from './taken';

/** A little-endian EXIF block with DateTimeOriginal in the Exif directory. */
function exifBlock(date: string): Uint8Array {
  const text = new TextEncoder().encode(`${date}\0`);
  const bytes = new Uint8Array(8 + 18 + 18 + text.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  // IFD0: one entry, the pointer to the Exif directory at 26.
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 26, true);
  view.setUint32(22, 0, true);
  // Exif: DateTimeOriginal, ASCII, its text at 44.
  view.setUint16(26, 1, true);
  view.setUint16(28, 0x9003, true);
  view.setUint16(30, 2, true);
  view.setUint32(32, text.length, true);
  view.setUint32(36, 44, true);
  view.setUint32(40, 0, true);
  bytes.set(text, 44);
  return bytes;
}

function jpegWith(tiff: Uint8Array): Blob {
  const app1 = new Uint8Array(4 + 6 + tiff.length);
  app1.set([0xff, 0xe1, ((tiff.length + 8) >> 8) & 0xff, (tiff.length + 8) & 0xff]);
  app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  app1.set(tiff, 10);
  return new Blob([new Uint8Array([0xff, 0xd8]), app1, new Uint8Array([0xff, 0xd9])]);
}

function box(type: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}

/** An MP4 whose movie header says it was made at `iso` (UTC); `moovLast` puts the movie box at the end. */
function mp4(iso: string, moovLast = false): Blob {
  const mvhd = new Uint8Array(100);
  const seconds = Date.parse(iso) / 1000 + 2_082_844_800;
  new DataView(mvhd.buffer).setUint32(4, seconds);
  const moov = box('moov', box('mvhd', mvhd));
  const ftyp = box('ftyp', new TextEncoder().encode('isom\0\0\0\0'));
  const mdat = box('mdat', new Uint8Array(5000));
  return new Blob(moovLast ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

describe('takenDate', () => {
  it('reads DateTimeOriginal from a JPEG, as a local time', async () => {
    const date = await takenDate(jpegWith(exifBlock('2025:07:14 09:30:15')));
    expect(date).toEqual(new Date(2025, 6, 14, 9, 30, 15));
  });

  it('reads an MP4’s creation time, with the movie box first or last', async () => {
    expect(await takenDate(mp4('2024-05-06T07:08:09Z'))).toEqual(new Date('2024-05-06T07:08:09Z'));
    expect(await takenDate(mp4('2024-05-06T07:08:09Z', true))).toEqual(
      new Date('2024-05-06T07:08:09Z'),
    );
  });

  it('has no date for other files, or for a broken one', async () => {
    expect(await takenDate(new Blob(['hello']))).toBeUndefined();
    expect(await takenDate(jpegWith(new Uint8Array(4)))).toBeUndefined();
    expect(exifDate('0000:00:00 00:00:00')).toBeUndefined();
  });
});
