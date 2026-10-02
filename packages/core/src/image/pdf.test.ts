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
