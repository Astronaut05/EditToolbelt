/**
 * P18 Images to PDF (tools/photo.md): a PDF of one image per page, written
 * here rather than with a library, since images on pages are all it needs.
 * JPEGs go in byte for byte (DCTDecode), so nothing is re-compressed; their
 * EXIF orientation is applied by the matrix that places them. Other images
 * arrive as deflated 8-bit RGB (FlateDecode), with any transparency as a
 * soft mask. Each image is scaled to fit the page inside its margins,
 * centred, keeping its shape.
 */

export interface PdfImage {
  /** jpeg: a JPEG file, as it is. raw: zlib-deflated 8-bit samples, row by row. */
  kind: 'jpeg' | 'raw';
  data: Uint8Array;
  /** The stored image's size in pixels, before any orientation. */
  width: number;
  height: number;
  /** 1 grey, 3 RGB. */
  colors: 1 | 3;
  /** raw: the alpha channel, deflated, when the image isn't fully opaque. */
  alpha?: Uint8Array;
  /** EXIF orientation 1–8: how the stored image turns to stand upright. */
  orientation?: number;
}

export interface PdfPage {
  /** Points (1/72 inch). */
  width: number;
  height: number;
  image: PdfImage;
  /** Where the upright image goes, in points from the bottom left. */
  box: { x: number; y: number; width: number; height: number };
}

export type PageSize = 'a4' | 'letter' | 'fit';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';

/** Points per millimetre, and a pixel's size on a "fit" page (96 px to the inch). */
export const PT_PER_MM = 72 / 25.4;
const PT_PER_PX = 0.75;

const SIZES: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** The upright size of a stored image: orientations 5–8 turn it on its side. */
export function uprightSize(image: Pick<PdfImage, 'width' | 'height' | 'orientation'>) {
  const turned = (image.orientation ?? 1) >= 5;
  return turned
    ? { width: image.height, height: image.width }
    : { width: image.width, height: image.height };
}

/** A page for an upright image of `width` × `height` px: its size, and the image's box on it. */
export function layoutPage(
  width: number,
  height: number,
  size: PageSize,
  orientation: PageOrientation,
  marginPt: number,
): Pick<PdfPage, 'width' | 'height' | 'box'> {
  if (size === 'fit') {
    const w = width * PT_PER_PX;
    const h = height * PT_PER_PX;
    return {
      width: w + 2 * marginPt,
      height: h + 2 * marginPt,
      box: { x: marginPt, y: marginPt, width: w, height: h },
    };
  }
  const [short, long] = SIZES[size];
  const landscape = orientation === 'landscape' || (orientation === 'auto' && width > height);
  const pageW = landscape ? long : short;
  const pageH = landscape ? short : long;
  const room = { width: pageW - 2 * marginPt, height: pageH - 2 * marginPt };
  const scale = Math.min(room.width / width, room.height / height);
  const w = width * scale;
  const h = height * scale;
  return {
    width: pageW,
    height: pageH,
    box: { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h },
  };
}

/**
 * The matrix (PDF's a b c d e f) that draws the stored image upright in
 * `box`. PDF maps an image's first row to the top of the unit square; EXIF
 * orientation says which way that row has to go.
 */
export function placement(box: PdfPage['box'], orientation = 1): number[] {
  // Upright position (X, Y in 0–1, Y up) as X = a·u + c·v + e, Y = b·u + d·v + f,
  // where u runs along the stored rows and v up the stored columns.
  const forms: Record<number, [number, number, number, number, number, number]> = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, 1, 0],
    3: [-1, 0, 0, -1, 1, 1],
    4: [1, 0, 0, -1, 0, 1],
    5: [0, -1, -1, 0, 1, 1],
    6: [0, -1, 1, 0, 0, 1],
    7: [0, 1, 1, 0, 0, 0],
    8: [0, 1, -1, 0, 1, 0],
  };
  const [a, b, c, d, e, f] = forms[orientation] ?? forms[1] ?? [1, 0, 0, 1, 0, 0];
  const { x, y, width: w, height: h } = box;
  return [w * a, h * b, w * c, h * d, x + w * e, y + h * f];
}

export interface JpegInfo {
  width: number;
  height: number;
  components: number;
  /** 8 for nearly every JPEG; 12 is rare and isn't passed through. */
  precision: number;
  orientation: number;
}

/** A JPEG's size, components and EXIF orientation, read from its markers; null if it isn't one. */
export function jpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    // Baseline, extended and progressive frames; not lossless, hierarchical or arithmetic.
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        precision: bytes[at + 4] ?? 0,
        height: ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0),
        width: ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0),
        components: bytes[at + 9] ?? 0,
        orientation,
      };
    }
    if (marker === 0xe1) orientation = exifOrientation(bytes.subarray(at + 4, at + 2 + length));
    if (marker === 0xda || marker === 0xd9) return null;
    at += 2 + length;
  }
  return null;
}

function exifOrientation(app1: Uint8Array): number {
  if (String.fromCharCode(...app1.subarray(0, 6)) !== 'Exif\0\0') return 1;
  const tiff = app1.subarray(6);
  const little = tiff[0] === 0x49;
  const u16 = (i: number) =>
    little
      ? (tiff[i] ?? 0) | ((tiff[i + 1] ?? 0) << 8)
      : ((tiff[i] ?? 0) << 8) | (tiff[i + 1] ?? 0);
  const u32 = (i: number) =>
    little ? (u16(i) | (u16(i + 2) << 16)) >>> 0 : ((u16(i) << 16) | u16(i + 2)) >>> 0;
  const ifd = u32(4);
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

const encoder = new TextEncoder();
const n = (v: number) => {
  const s = (Math.round(v * 1000) / 1000).toString();
  return s === '-0' ? '0' : s;
};

/** The PDF's bytes: one page per entry, each with its image placed upright in its box. */
export function writePdf(pages: readonly PdfPage[], title = ''): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  /** Object numbers are handed out in order: the n-th object written is n. */
  const object = (id: number, dict: string, stream?: Uint8Array) => {
    offsets[id] = length;
    push(`${String(id)} 0 obj\n${dict}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  // The second line's bytes above 127 tell file tools this is binary.
  push('%PDF-1.4\n');
  push(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  // 1 catalog, 2 pages, 3 info; then per page: page, contents, image, and its mask if any.
  let next = 4;
  const plan = pages.map((page) => {
    const ids = {
      page: next,
      contents: next + 1,
      image: next + 2,
      mask: page.image.alpha ? next + 3 : 0,
    };
    next += page.image.alpha ? 4 : 3;
    return { page, ids };
  });
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    `<< /Type /Pages /Kids [${plan.map(({ ids }) => `${String(ids.page)} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`,
  );
  const escaped = title.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');
  object(3, `<< /Producer (EditToolbelt)${escaped ? ` /Title (${escaped})` : ''} >>`);
  for (const { page, ids } of plan) {
    const { image } = page;
    object(
      ids.page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources << /XObject << /Im0 ${String(ids.image)} 0 R >> >> /Contents ${String(ids.contents)} 0 R >>`,
    );
    const content = encoder.encode(
      `q ${placement(page.box, image.orientation).map(n).join(' ')} cm /Im0 Do Q\n`,
    );
    object(ids.contents, `<< /Length ${String(content.length)} >>`, content);
    const space = image.colors === 1 ? '/DeviceGray' : '/DeviceRGB';
    const filter = image.kind === 'jpeg' ? '/DCTDecode' : '/FlateDecode';
    object(
      ids.image,
      `<< /Type /XObject /Subtype /Image /Width ${String(image.width)} /Height ${String(image.height)} /ColorSpace ${space} /BitsPerComponent 8 /Filter ${filter} /Length ${String(image.data.length)}${ids.mask ? ` /SMask ${String(ids.mask)} 0 R` : ''} >>`,
      image.data,
    );
    if (ids.mask && image.alpha) {
      object(
        ids.mask,
        `<< /Type /XObject /Subtype /Image /Width ${String(image.width)} /Height ${String(image.height)} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${String(image.alpha.length)} >>`,
        image.alpha,
      );
    }
  }
  const xref = length;
  const count = next;
  push(`xref\n0 ${String(count)}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id += 1) {
    push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${String(count)} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
