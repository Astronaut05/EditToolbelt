/**
 * `image-geometry` for P18 Images to PDF (tools/photo.md): the images, in
 * the order given, one to a page. JPEGs go in as they are, so nothing is
 * re-compressed; anything else is decoded by the browser (upright, as it
 * shows it) and stored losslessly, deflated by fflate, with its transparency
 * kept. @etb/core writes the PDF.
 */
import { pdf } from '@etb/core';
import { zlibSync } from 'fflate';

import { EngineAbortError } from '../dummy';
import type { Engine, EngineOutput } from '../types';
import { ImageInputError } from './image-codec';

export interface ImagesToPdfOptions {
  /** a4, letter or fit (each page the image's own size). */
  size?: string;
  /** auto (each page turned to its image), portrait or landscape. */
  orientation?: string;
  /** none, small (10 mm) or large (20 mm). */
  margin?: string;
  /** The images, in order (the shell's list). */
  files?: Blob[];
}

const MARGIN_MM: Record<string, number> = { none: 0, small: 10, large: 20 };
/** Pages in one PDF: plenty for a scan or a portfolio, and the memory stays reasonable. */
export const MAX_PAGES = 100;

const nameOf = (file: Blob, i: number) =>
  file instanceof File ? file.name : `Image ${String(i + 1)}`;

/** One image, ready for a page. */
async function prepare(file: Blob, name: string): Promise<pdf.PdfImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = pdf.jpegInfo(bytes);
  if (jpeg && jpeg.precision === 8 && (jpeg.components === 1 || jpeg.components === 3)) {
    return {
      kind: 'jpeg',
      data: bytes,
      width: jpeg.width,
      height: jpeg.height,
      colors: jpeg.components,
      orientation: jpeg.orientation,
    };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new ImageInputError(
      `${name} can’t be read in this browser. HEIC opens only in Safari; try JPG, PNG or WebP.`,
      { cause: error },
    );
  }
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in this browser');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  let opaque = true;
  for (let p = 0, q = 0; p < width * height; p += 1, q += 4) {
    rgb[p * 3] = rgba[q] ?? 0;
    rgb[p * 3 + 1] = rgba[q + 1] ?? 0;
    rgb[p * 3 + 2] = rgba[q + 2] ?? 0;
    const a = rgba[q + 3] ?? 255;
    alpha[p] = a;
    if (a !== 255) opaque = false;
  }
  return {
    kind: 'raw',
    data: zlibSync(rgb, { level: 6 }),
    width,
    height,
    colors: 3,
    ...(!opaque && { alpha: zlibSync(alpha, { level: 6 }) }),
  };
}

export const imagesToPdfEngine: Engine<ImagesToPdfOptions> = {
  capabilities: () => ({
    supported: typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined',
    reason: 'This browser can’t read images here. Try a current Chrome, Edge, Safari or Firefox.',
  }),
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 20_000_000) }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const files = opts.files?.length ? opts.files : [input];
    if (files.length > MAX_PAGES) {
      throw new ImageInputError(
        `That’s ${String(files.length)} images; a PDF here takes up to ${String(MAX_PAGES)}.`,
      );
    }
    const size: pdf.PageSize = opts.size === 'letter' || opts.size === 'fit' ? opts.size : 'a4';
    const orientation: pdf.PageOrientation =
      opts.orientation === 'portrait' || opts.orientation === 'landscape'
        ? opts.orientation
        : 'auto';
    const margin = (MARGIN_MM[opts.margin ?? 'small'] ?? 10) * pdf.PT_PER_MM;
    const pages: pdf.PdfPage[] = [];
    let copied = 0;
    for (const [i, file] of files.entries()) {
      if (ctx.signal.aborted) throw new EngineAbortError();
      ctx.progress(i / files.length, 'Adding the images', {
        step: `${String(i + 1)} of ${String(files.length)}`,
      });
      const image = await prepare(file, nameOf(file, i));
      if (image.kind === 'jpeg') copied += 1;
      const upright = pdf.uprightSize(image);
      pages.push({
        image,
        ...pdf.layoutPage(upright.width, upright.height, size, orientation, margin),
      });
    }
    // Named after the first image in the order set, as it was called.
    const first = nameOf(files[0] ?? input, 0);
    const dot = first.lastIndexOf('.');
    const stem = (dot > 0 ? first.slice(0, dot) : first) || 'images';
    const bytes = pdf.writePdf(pages, stem);
    ctx.progress(1, 'Done');
    const pageLabel = size === 'fit' ? 'each the image’s size' : size === 'a4' ? 'A4' : 'US Letter';
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      ext: 'pdf',
      name: `${stem}.pdf`,
      path: 'Browser',
      notes: [
        `${String(pages.length)} ${pages.length === 1 ? 'page' : 'pages'}, ${pageLabel}`,
        copied === pages.length
          ? 'The JPEGs went in as they are: no quality lost'
          : copied > 0
            ? `${String(copied)} JPEG${copied === 1 ? '' : 's'} went in as ${copied === 1 ? 'it is' : 'they are'}; the rest are stored losslessly`
            : 'Stored losslessly, transparency kept',
      ],
      details: [
        { label: 'Pages', value: String(pages.length) },
        { label: 'Page size', value: pageLabel },
      ],
    };
  },
};
