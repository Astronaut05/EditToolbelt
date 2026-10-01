import { describe, expect, it } from 'vitest';

import { crc32 } from './exif';
import { inspectMetadata, reportText } from './metadata';
import { readTiff, writeTiff, type TiffEntry } from './tiff';

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const rationals = (...pairs: [number, number][]) =>
  Uint8Array.from(pairs.flatMap(([a, b]) => [...u32le(a), ...u32le(b)]));

const entry = (
  dir: TiffEntry['dir'],
  tag: number,
  type: number,
  count: number,
  value: Uint8Array | number[],
): TiffEntry => ({
  dir,
  tag,
  type,
  count,
  value: Uint8Array.from(value),
});
const ascii = (dir: TiffEntry['dir'], tag: number, value: string) =>
  entry(dir, tag, 2, value.length + 1, text(`${value}\0`));

/** A phone photo's EXIF: camera, settings, date, a serial number, GPS in Tashkent, Orientation 6. */
function phoneExif(orientation = 6): Uint8Array {
  const block = writeTiff(true, [
    ascii('ifd0', 0x010f, 'Apple'),
    ascii('ifd0', 0x0110, 'iPhone 15 Pro'),
    entry('ifd0', 0x0112, 3, 1, u16le(orientation)),
    ascii('ifd0', 0x0131, '18.0'),
    ascii('ifd0', 0x013b, 'Ann Example'),
    entry('exif', 0x829a, 5, 1, rationals([1, 120])),
    entry('exif', 0x829d, 5, 1, rationals([178, 100])),
    entry('exif', 0x8827, 3, 1, u16le(64)),
    ascii('exif', 0x9003, '2026:09:30 14:22:05'),
    entry('exif', 0x920a, 5, 1, rationals([6765, 1000])),
    ascii('exif', 0xa431, 'SN-123456'),
    ascii('exif', 0xa434, 'iPhone 15 Pro back camera'),
    entry('exif', 0x927c, 7, 6, text('Apple!')),
    ascii('gps', 1, 'N'),
    entry('gps', 2, 5, 3, rationals([41, 1], [18, 1], [3892, 100])),
    ascii('gps', 3, 'E'),
    entry('gps', 4, 5, 3, rationals([69, 1], [14, 1], [2602, 100])),
    entry('gps', 6, 5, 1, rationals([455, 1])),
  ]);
  if (!block) throw new Error('no block');
  return block;
}

function segment(marker: number, body: Uint8Array): number[] {
  return [0xff, marker, ...u16be(body.length + 2), ...body];
}

const SCAN = [0x01, 0x02, 0xff, 0x00, 0x03, 0xff, 0xd3, 0x04, 0x05];

/** A JPEG skeleton with every kind of metadata, a scan to keep byte for byte, and a trailer. */
function phoneJpeg(): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    ...segment(0xe0, text('JFIF\x00\x01\x02\x00\x00\x01\x00\x01\x00\x00')),
    ...segment(0xe1, Uint8Array.from([...text('Exif\0\0'), ...phoneExif()])),
    ...segment(
      0xe1,
      text(
        'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><exif:GPSLatitude>41,18N</exif:GPSLatitude></x:xmpmeta>',
      ),
    ),
    ...segment(0xe2, text('ICC_PROFILE\0\x01\x01profile')),
    ...segment(
      0xed,
      Uint8Array.from([
        ...text('Photoshop 3.0\x008BIM'),
        0x1c,
        0x02,
        0x5a,
        0,
        8,
        ...text('Tashkent'),
      ]),
    ),
    ...segment(0xfe, text('Shot on my phone')),
    ...segment(0xdb, Uint8Array.from(Array.from({ length: 65 }, (_, i) => i))),
    ...segment(0xc0, Uint8Array.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
    ...segment(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])),
    ...SCAN,
    0xff,
    0xd9,
    ...text('MotionPhoto_Data trailer'),
  ]);
}

function scanOf(jpeg: Uint8Array): number[] {
  const at = jpeg.findIndex((b, i) => b === 0xff && jpeg[i + 1] === 0xda);
  const end = jpeg.findIndex((b, i) => i > at && b === 0xff && jpeg[i + 1] === 0xd9);
  return Array.from(jpeg.subarray(at, end + 2));
}

const has = (haystack: Uint8Array, needle: string) =>
  new TextDecoder('latin1').decode(haystack).includes(needle);

describe('reading a photo’s metadata (P15)', () => {
  it('names camera, settings, date, people and the place', () => {
    const report = inspectMetadata(phoneJpeg(), 'jpeg', 'none');
    const value = (label: string) => report.fields.find((f) => f.label === label)?.value;
    expect(value('Make')).toBe('Apple');
    expect(value('Model')).toBe('iPhone 15 Pro');
    expect(value('Exposure')).toBe('1/120 s');
    expect(value('Aperture')).toBe('f/1.8');
    expect(value('ISO')).toBe('64');
    expect(value('Focal length')).toBe('6.8 mm');
    expect(value('Taken')).toBe('2026:09:30 14:22:05');
    expect(value('Camera serial number')).toBe('SN-123456');
    expect(value('Artist')).toBe('Ann Example');
    expect(value('Coordinates')).toBe('41.310811, 69.240561');
    expect(value('Altitude')).toBe('455 m');
    expect(value('Orientation')).toBe('Turned 90° right');
    expect(report.extras.map((e) => e.label)).toEqual([
      'XMP',
      'Colour profile',
      'IPTC',
      'Comment',
      'Extra data after the photo',
    ]);
    expect(report.bytes).toBeNull();
    const shown = reportText(report, 'none', 'IMG_1.jpg');
    expect(shown).toContain('LOCATION\nCoordinates       41.310811, 69.240561');
    expect(shown).not.toContain('(removed)');
  });
});

describe('removing it from a JPEG without touching the pixels', () => {
  it('all: only the orientation and the colour profile are left', () => {
    const source = phoneJpeg();
    const report = inspectMetadata(source, 'jpeg', 'all');
    const out = report.bytes ?? new Uint8Array();
    expect(scanOf(out)).toEqual(scanOf(source));
    expect(out.at(-2)).toBe(0xff);
    expect(out.at(-1)).toBe(0xd9); // the trailer is gone
    for (const gone of [
      'Apple',
      'GPSLatitude',
      'Tashkent',
      'Shot on my phone',
      'SN-123456',
      'Ann Example',
    ]) {
      expect(has(out, gone), gone).toBe(false);
    }
    expect(has(out, 'ICC_PROFILE')).toBe(true);
    const left = inspectMetadata(out, 'jpeg', 'none');
    expect(left.fields).toEqual([
      { group: 'other', label: 'Orientation', value: 'Turned 90° right' },
    ]);
    expect(reportText(report, 'all', 'a.jpg')).toContain(
      'Coordinates       41.310811, 69.240561   (removed)',
    );
  });

  it('all: an upright photo keeps no EXIF at all', () => {
    const jpeg = Uint8Array.from([
      0xff,
      0xd8,
      ...segment(0xe1, Uint8Array.from([...text('Exif\0\0'), ...phoneExif(1)])),
      ...segment(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])),
      ...SCAN,
      0xff,
      0xd9,
    ]);
    const out = inspectMetadata(jpeg, 'jpeg', 'all').bytes ?? new Uint8Array();
    expect(has(out, 'Exif')).toBe(false);
  });

  it('location: GPS, and XMP and IPTC naming a place, go; the rest stays', () => {
    const source = phoneJpeg();
    const out = inspectMetadata(source, 'jpeg', 'location').bytes ?? new Uint8Array();
    expect(scanOf(out)).toEqual(scanOf(source));
    const left = inspectMetadata(out, 'jpeg', 'none');
    expect(left.fields.some((f) => f.group === 'location')).toBe(false);
    expect(left.fields.find((f) => f.label === 'Make')?.value).toBe('Apple');
    expect(left.fields.find((f) => f.label === 'Taken')).toBeDefined();
    expect(has(out, 'GPSLatitude')).toBe(false);
    expect(has(out, 'Tashkent')).toBe(false);
    expect(has(out, 'Shot on my phone')).toBe(true);
  });

  it('camera: make, model, lens and exposure stay; date, people and place go', () => {
    const out = inspectMetadata(phoneJpeg(), 'jpeg', 'camera').bytes ?? new Uint8Array();
    const labels = inspectMetadata(out, 'jpeg', 'none').fields.map((f) => f.label);
    expect(labels).toEqual([
      'Make',
      'Model',
      'Orientation',
      'Exposure',
      'Aperture',
      'ISO',
      'Focal length',
      'Lens',
    ]);
  });
});

function pngChunk(type: string, data: Uint8Array): number[] {
  const body = Uint8Array.from([...text(type), ...data]);
  return [...u32be(data.length), ...body, ...u32be(crc32(body))];
}

function checkPngCrcs(png: Uint8Array): string[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  for (let i = 8; i + 12 <= png.length;) {
    const length = view.getUint32(i);
    const body = png.subarray(i + 4, i + 8 + length);
    expect(view.getUint32(i + 8 + length)).toBe(crc32(body));
    types.push(String.fromCharCode(...body.subarray(0, 4)));
    i += 12 + length;
  }
  return types;
}

describe('PNG and WebP, rewritten chunk by chunk', () => {
  it('PNG: text, XMP and dates go; pixels and the colour profile stay', () => {
    const png = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...pngChunk('IHDR', Uint8Array.from([...u32be(4), ...u32be(4), 8, 6, 0, 0, 0])),
      ...pngChunk('iCCP', text('sRGB\x00\x00profile')),
      ...pngChunk('eXIf', phoneExif()),
      ...pngChunk('tEXt', text('Author\0Ann Example')),
      ...pngChunk('iTXt', text('XML:com.adobe.xmp\0\0\0\0\0<exif:GPSLatitude/>')),
      ...pngChunk('tIME', Uint8Array.from([7, 234, 9, 30, 14, 22, 5])),
      ...pngChunk('IDAT', text('pixels')),
      ...pngChunk('IEND', new Uint8Array()),
    ]);
    const report = inspectMetadata(png, 'png', 'all');
    const out = report.bytes ?? new Uint8Array();
    expect(checkPngCrcs(out)).toEqual(['IHDR', 'iCCP', 'eXIf', 'IDAT', 'IEND']);
    expect(has(out, 'Ann Example')).toBe(false);
    expect(has(out, 'pixels')).toBe(true);
    expect(report.extras.map((e) => [e.label, e.removed])).toEqual([
      ['Colour profile', false],
      ['Text “Author”', true],
      ['XMP', true],
      ['Last modified', true],
    ]);
  });

  it('WebP: EXIF and XMP go, and VP8X says so', () => {
    const exif = phoneExif(1);
    const chunk = (type: string, data: Uint8Array) => [
      ...text(type),
      ...u32le(data.length),
      ...data,
      ...(data.length % 2 ? [0] : []),
    ];
    const body = [
      ...chunk('VP8X', Uint8Array.from([0x0c, 0, 0, 0, 3, 0, 0, 3, 0, 0])),
      ...chunk('VP8L', text('pixels!')),
      ...chunk('EXIF', exif),
      ...chunk('XMP ', text('<x:xmpmeta/>')),
    ];
    const webp = Uint8Array.from([
      ...text('RIFF'),
      ...u32le(4 + body.length),
      ...text('WEBP'),
      ...body,
    ]);
    const out = inspectMetadata(webp, 'webp', 'all').bytes ?? new Uint8Array();
    const view = new DataView(out.buffer);
    expect(view.getUint32(4, true)).toBe(out.length - 8);
    expect(out[20]).toBe(0); // VP8X flags: no EXIF, no XMP
    expect(has(out, 'EXIF')).toBe(false);
    expect(has(out, 'XMP')).toBe(false);
    expect(has(out, 'pixels!')).toBe(true);
  });
});

describe('the TIFF block', () => {
  it('reads what it writes, sorted, without maker notes or a thumbnail', () => {
    const block = readTiff(phoneExif());
    expect(block?.le).toBe(true);
    expect(block?.thumbnail).toBe(false);
    expect(block?.entries.some((e) => e.tag === 0x927c)).toBe(false);
    const again = writeTiff(true, block?.entries ?? []);
    expect(readTiff(again ?? new Uint8Array())?.entries).toEqual(block?.entries);
    expect(writeTiff(true, [])).toBeNull();
  });
});
