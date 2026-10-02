import { describe, expect, it } from 'vitest';

import {
  jpegInfo,
  layoutPage,
  placement,
  PT_PER_MM,
  uprightSize,
  writePdf,
  type PdfPage,
} from './pdf';

/** The start of a JPEG: SOI, an EXIF block with an orientation, and a baseline frame header. */
function jpegHead(width: number, height: number, orientation: number, components = 3): Uint8Array {
  const tiff = [
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // big-endian, IFD at 8
    0x00,
    0x01, // one entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00, // orientation, SHORT
    0x00,
    0x00,
    0x00,
    0x00,
  ];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]; // "Exif\0\0"
  const app1 = [0xff, 0xe1, ((exif.length + 2) >> 8) & 0xff, (exif.length + 2) & 0xff, ...exif];
  const sof = [
    0xff,
    0xc0,
    0x00,
    8 + 3 * components,
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    components,
  ];
  for (let c = 0; c < components; c += 1) sof.push(c + 1, 0x11, 0);
  return Uint8Array.from([0xff, 0xd8, ...app1, ...sof]);
}

describe('jpegInfo', () => {
  it('reads the size, components and EXIF orientation', () => {
    expect(jpegInfo(jpegHead(4000, 3000, 6))).toEqual({
      width: 4000,
      height: 3000,
      components: 3,
      precision: 8,
      orientation: 6,
    });
    expect(jpegInfo(jpegHead(10, 20, 1, 1))?.components).toBe(1);
    expect(jpegInfo(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

/** A made-up ICC profile: a 132-byte header for `space` ("RGB " or "GRAY"), version `major`, no tags. */
function profile(space: string, major = 4): Uint8Array {
  const icc = new Uint8Array(132);
  icc.set([0, 0, 0, 132]);
  icc[8] = major;
  icc.set(
    Array.from('mntr' + space + 'XYZ ', (c) => c.charCodeAt(0)),
    12,
  );
  icc.set(
    Array.from('acsp', (c) => c.charCodeAt(0)),
    36,
  );
  return icc;
}

/** APP2 "ICC_PROFILE" segments carrying `icc` in `pieces` parts. */
function iccSegments(icc: Uint8Array, pieces: number, count = pieces): number[] {
  const out: number[] = [];
  const size = Math.ceil(icc.length / pieces);
  for (let n = 0; n < pieces; n += 1) {
    const part = [...icc.subarray(n * size, (n + 1) * size)];
    const body = [...Array.from('ICC_PROFILE\0', (c) => c.charCodeAt(0)), n + 1, count, ...part];
    out.push(0xff, 0xe2, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body);
  }
  return out;
}

/** A JPEG head with ICC segments before its frame header. */
const withIcc = (segments: number[], components = 3) => {
  const head = jpegHead(64, 48, 1, components);
  // After SOI and the EXIF block, before the frame header.
  const sof = head.findIndex((b, i) => b === 0xff && head[i + 1] === 0xc0);
  return Uint8Array.from([...head.subarray(0, sof), ...segments, ...head.subarray(sof)]);
};

describe('ICC profiles', () => {
  it('are put back together from their pieces, in order', () => {
    const icc = profile('RGB ');
    expect(jpegInfo(withIcc(iccSegments(icc, 1)))?.icc).toEqual(icc);
    expect(jpegInfo(withIcc(iccSegments(icc, 3)))?.icc).toEqual(icc);
    // A grey JPEG with a grey profile.
    const grey = profile('GRAY', 2);
    expect(jpegInfo(withIcc(iccSegments(grey, 1), 1))?.icc).toEqual(grey);
  });

  it('are left out when a piece is missing or they don’t fit the JPEG’s colours', () => {
    const icc = profile('RGB ');
    // Two pieces of three.
    expect(jpegInfo(withIcc(iccSegments(icc, 2, 3)))?.icc).toBeUndefined();
    // An RGB profile on a grey JPEG, and a CMYK one on an RGB JPEG.
    expect(jpegInfo(withIcc(iccSegments(icc, 1), 1))?.icc).toBeUndefined();
    expect(jpegInfo(withIcc(iccSegments(profile('CMYK'), 1)))?.icc).toBeUndefined();
    // Not a profile at all.
    const junk = new Uint8Array(132);
    expect(jpegInfo(withIcc(iccSegments(junk, 1)))?.icc).toBeUndefined();
    expect(jpegInfo(jpegHead(64, 48, 1))?.icc).toBeUndefined();
  });
});

describe('layout', () => {
  it('fits a wide image on a landscape A4 inside its margins, centred', () => {
    const margin = 10 * PT_PER_MM;
    const page = layoutPage(2000, 1000, 'a4', 'auto', margin);
    expect([page.width, page.height]).toEqual([841.89, 595.28]);
    expect(page.box.width).toBeCloseTo(841.89 - 2 * margin);
    expect(page.box.height).toBeCloseTo(page.box.width / 2);
    expect(page.box.x).toBeCloseTo(margin);
    expect(page.box.y + page.box.height / 2).toBeCloseTo(595.28 / 2);
  });

  it('keeps portrait when asked, and a "fit" page is the image at 96 px to the inch', () => {
    expect(layoutPage(2000, 1000, 'letter', 'portrait', 0).width).toBe(612);
    expect(layoutPage(800, 600, 'fit', 'auto', 0)).toEqual({
      width: 600,
      height: 450,
      box: { x: 0, y: 0, width: 600, height: 450 },
    });
  });

  it('turns orientations 5–8 on their side, and places them upright', () => {
    expect(uprightSize({ width: 4000, height: 3000, orientation: 6 })).toEqual({
      width: 3000,
      height: 4000,
    });
    // Turned 90° right: the stored top-left corner ends up top right.
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = placement(
      { x: 10, y: 20, width: 100, height: 200 },
      6,
    );
    const at = (u: number, v: number) => [a * u + c * v + e, b * u + d * v + f];
    expect(at(0, 1)).toEqual([110, 220]);
    expect(at(1, 1)).toEqual([110, 20]);
    expect(placement({ x: 0, y: 0, width: 5, height: 7 })).toEqual([5, 0, 0, 7, 0, 0]);
  });
});

describe('writePdf', () => {
  const page = (kind: 'jpeg' | 'raw', alpha = false): PdfPage => ({
    width: 600,
    height: 450,
    box: { x: 0, y: 0, width: 600, height: 450 },
    image: {
      kind,
      data: Uint8Array.from([1, 2, 3, 4, 5]),
      width: 800,
      height: 600,
      colors: 3,
      ...(alpha && { alpha: Uint8Array.from([9, 9]) }),
    },
  });

  it('gives a JPEG with a profile an ICCBased colour space, in PDF 1.5 for a v4 profile', () => {
    const icc = profile('RGB ');
    const tagged: PdfPage = { ...page('jpeg'), image: { ...page('jpeg').image, icc } };
    const bytes = writePdf([tagged, page('raw', true)]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.5')).toBe(true);
    // Objects 4-7 are the first page's: page, contents, image and its profile.
    expect(text).toContain('/ColorSpace [/ICCBased 7 0 R]');
    expect(text).toContain('7 0 obj\n<< /N 3 /Alternate /DeviceRGB /Length 132 >>\nstream\n');
    const at = text.indexOf('7 0 obj');
    const stream = text.indexOf('stream\n', at) + 'stream\n'.length;
    expect(bytes.subarray(stream, stream + 132)).toEqual(icc);
    // The page without one stays DeviceRGB; a v2 profile stays PDF 1.4.
    expect(text).toContain('/ColorSpace /DeviceRGB');
    const v2: PdfPage = {
      ...page('jpeg'),
      image: { ...page('jpeg').image, icc: profile('RGB ', 2) },
    };
    expect(new TextDecoder('latin1').decode(writePdf([v2])).startsWith('%PDF-1.4')).toBe(true);
    // Every object is still where the table says.
    const start = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    const table = text.slice(start).split('\n');
    const size = Number(/0 (\d+)/.exec(table[1] ?? '')?.[1]);
    expect(size).toBe(12);
    for (let id = 1; id < size; id += 1) {
      const offset = Number(table[2 + id]?.slice(0, 10));
      expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${String(id)} 0 obj`));
    }
  });

  it('writes a PDF whose cross-reference table points at every object', () => {
    const bytes = writePdf([page('jpeg'), page('raw', true)], 'Trip (day 1)');
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/Title (Trip \\(day 1\\))');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/SMask');
    const start = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    const table = text.slice(start).split('\n');
    const size = Number(/0 (\d+)/.exec(table[1] ?? '')?.[1]);
    // 3 shared objects, 3 for the JPEG page, 4 for the page with a mask, and object 0.
    expect(size).toBe(11);
    for (let id = 1; id < size; id += 1) {
      const offset = Number(table[2 + id]?.slice(0, 10));
      expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${String(id)} 0 obj`));
    }
  });
});
