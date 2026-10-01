/**
 * P15 Photo Metadata Viewer & Remover (tools/photo.md): what a photo
 * carries, and the same photo without it. JPEG, PNG and WebP are rewritten
 * around their pixels, which stay byte for byte as they were; other formats
 * are decoded and saved again as PNG with no metadata.
 *
 * Kept whatever is chosen: the colour profile (removing it changes colours)
 * and the orientation (removing it turns the photo).
 */
import type { Engine, EngineOutput } from '../types';
import { crc32 } from './exif';
import { baseJob, checkImage, imageCodecEngine, runImageJob } from './image-codec';
import { FORMAT_LABELS, headerSize, type ImageFormat } from './sniff';
import {
  describe,
  isCameraOrSettings,
  readTiff,
  TAG_ORIENTATION,
  writeTiff,
  type Field,
  type Group,
  type TiffBlock,
  type TiffEntry,
} from './tiff';

/**
 * all: everything but orientation and the colour profile. location: GPS
 * (and XMP or IPTC that hold a place). camera: keep only camera, lens and
 * exposure settings. none: change nothing, just look.
 */
export type Removal = 'all' | 'location' | 'camera' | 'none';

export interface Extra {
  label: string;
  value: string;
  /** Whether this removal takes it out. */
  removed: boolean;
}

export interface MetadataReport {
  format: ImageFormat;
  width?: number;
  height?: number;
  fields: Field[];
  /** What else is in the file besides EXIF: XMP, IPTC, comments, colour profile, extra images. */
  extras: Extra[];
  /** EXIF fields taken out (by label). */
  removedFields: Field[];
  /** The rewritten file, or null when the format is re-encoded instead (or nothing changes). */
  bytes: Uint8Array | null;
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_EXTENDED = 'http://ns.adobe.com/xmp/extension/\0';

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + length)));

const startsWith = (bytes: Uint8Array, at: number, prefix: number[] | string) =>
  typeof prefix === 'string'
    ? ascii(bytes, at, prefix.length) === prefix
    : prefix.every((byte, i) => bytes[at + i] === byte);

const kb = (n: number) => (n < 1024 ? `${String(n)} bytes` : `${(n / 1024).toFixed(1)} KB`);

/** Text that names a place: XMP with GPS or city fields. */
const placeIn = (bytes: Uint8Array) => {
  const s = new TextDecoder('latin1').decode(bytes);
  return /GPS(Latitude|Longitude)|photoshop:City|Iptc4xmpCore:Location|LocationShown|LocationCreated/.test(
    s,
  );
};

/** IPTC datasets that name a place: city, sub-location, province, country. */
function iptcPlace(bytes: Uint8Array): boolean {
  for (let i = 0; i + 2 < bytes.length; i += 1) {
    if (
      bytes[i] === 0x1c &&
      bytes[i + 1] === 0x02 &&
      [0x5a, 0x5c, 0x5f, 0x64, 0x65].includes(bytes[i + 2] ?? 0)
    ) {
      return true;
    }
  }
  return false;
}

// ── EXIF, whatever the container ─────────────────────────────────────────

interface ExifPlan {
  block: TiffBlock | null;
  removed: Field[];
  /** The block to write back; null to write none. */
  out: Uint8Array | null;
}

function orientationOnly(block: TiffBlock): TiffEntry[] {
  return block.entries.filter(
    (e) =>
      e.dir === 'ifd0' &&
      e.tag === TAG_ORIENTATION &&
      !(e.value[0] === (block.le ? 1 : 0) && e.value[1] === (block.le ? 0 : 1)),
  );
}

function planExif(tiff: Uint8Array | null, removal: Removal): ExifPlan {
  const block = tiff ? readTiff(tiff) : null;
  if (!block) return { block, removed: [], out: tiff && removal === 'none' ? tiff : null };
  const all = describe(block);
  if (removal === 'none') return { block, removed: [], out: tiff };
  let kept: TiffEntry[];
  if (removal === 'location') kept = block.entries.filter((e) => e.dir !== 'gps');
  else if (removal === 'camera') {
    kept = [...block.entries.filter(isCameraOrSettings), ...orientationOnly(block)];
  } else kept = orientationOnly(block);
  const left = new Set(describe({ ...block, entries: kept }).map((f) => `${f.group}:${f.label}`));
  return {
    block,
    removed: all.filter((f) => !left.has(`${f.group}:${f.label}`)),
    out: writeTiff(block.le, kept),
  };
}

// ── JPEG ─────────────────────────────────────────────────────────────────

interface Segment {
  marker: number;
  start: number;
  end: number;
}

/** The marker segments before the first scan, the scan through EOI, and any bytes after it. */
function jpegParts(
  jpeg: Uint8Array,
): { segments: Segment[]; scanStart: number; eoi: number } | null {
  const segments: Segment[] = [];
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xda) break;
    const length = ((jpeg[i + 2] ?? 0) << 8) | (jpeg[i + 3] ?? 0);
    segments.push({ marker, start: i, end: i + 2 + length });
    i += 2 + length;
  }
  const scanStart = i;
  // Walk the scans to this image's own EOI: data, then markers with lengths, until FFD9.
  let at = scanStart;
  while (at + 1 < jpeg.length) {
    if (jpeg[at] !== 0xff) {
      at += 1;
      continue;
    }
    const next = jpeg[at + 1] ?? 0;
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
      at += next === 0xff ? 1 : 2;
      continue;
    }
    if (next === 0xd9) return { segments, scanStart, eoi: at + 2 };
    const length = ((jpeg[at + 2] ?? 0) << 8) | (jpeg[at + 3] ?? 0);
    at += 2 + length;
  }
  return { segments, scanStart, eoi: jpeg.length };
}

function rewriteJpeg(
  jpeg: Uint8Array,
  removal: Removal,
  report: MetadataReport,
): Uint8Array | null {
  const parts = jpegParts(jpeg);
  if (!parts) return null;
  const strict = removal === 'all' || removal === 'camera';
  const out: Uint8Array[] = [jpeg.subarray(0, 2)];
  let exifDone = false;
  const trailer = jpeg.length - parts.eoi;
  // Extra images after the end can carry their own EXIF, so any removal drops them.
  const dropTrailer = trailer > 0 && removal !== 'none';
  for (const segment of parts.segments) {
    const body = jpeg.subarray(segment.start + 4, segment.end);
    const keep = () => out.push(jpeg.subarray(segment.start, segment.end));
    const marker = segment.marker;
    if (marker === 0xe1 && startsWith(body, 0, EXIF_HEADER)) {
      if (exifDone) continue;
      exifDone = true;
      const plan = planExif(body.subarray(6), removal);
      report.fields = plan.block ? describe(plan.block) : [];
      report.removedFields = plan.removed;
      if (plan.block?.thumbnail) {
        report.extras.push({
          label: 'Preview image',
          value: 'A small copy of the photo inside the EXIF',
          removed: removal !== 'none',
        });
      }
      if (removal === 'none') {
        keep();
        continue;
      }
      if (plan.out) out.push(app1(plan.out));
      continue;
    }
    if (marker === 0xe1 && (startsWith(body, 0, XMP_HEADER) || startsWith(body, 0, XMP_EXTENDED))) {
      const drop = removal !== 'none' && (strict || placeIn(body));
      report.extras.push({ label: 'XMP', value: kb(body.length), removed: drop });
      if (!drop) keep();
      continue;
    }
    if (marker === 0xe2 && startsWith(body, 0, 'ICC_PROFILE\0')) {
      if (!report.extras.some((e) => e.label === 'Colour profile')) {
        report.extras.push({
          label: 'Colour profile',
          value: 'Kept: removing it would change the colours',
          removed: false,
        });
      }
      keep();
      continue;
    }
    if (marker === 0xe2 && startsWith(body, 0, 'MPF\0')) {
      // The index of the extra images after the end: goes with them.
      if (!dropTrailer) keep();
      continue;
    }
    if (marker === 0xed) {
      const drop = removal !== 'none' && (strict || iptcPlace(body));
      report.extras.push({ label: 'IPTC', value: kb(body.length), removed: drop });
      if (!drop) keep();
      continue;
    }
    if (marker === 0xfe) {
      const drop = strict;
      report.extras.push({ label: 'Comment', value: kb(body.length), removed: drop });
      if (!drop) keep();
      continue;
    }
    const app = marker >= 0xe3 && marker <= 0xef && marker !== 0xee;
    if (app) {
      // APP14 (0xEE) is Adobe's colour transform and stays; the rest are vendors' metadata.
      const drop = strict;
      report.extras.push({
        label: `APP${String(marker - 0xe0)} block`,
        value: kb(body.length),
        removed: drop,
      });
      if (!drop) keep();
      continue;
    }
    keep();
  }
  if (trailer > 0) {
    report.extras.push({
      label: 'Extra data after the photo',
      value: `${kb(trailer)} (motion photo, depth map or HDR layer)`,
      removed: dropTrailer,
    });
  }
  if (removal === 'none') return null;
  out.push(jpeg.subarray(parts.scanStart, dropTrailer ? parts.eoi : jpeg.length));
  const size = out.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let at = 0;
  for (const part of out) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

function app1(tiff: Uint8Array): Uint8Array {
  const length = 2 + 6 + tiff.length;
  const out = new Uint8Array(2 + length);
  out.set([0xff, 0xe1, length >> 8, length & 0xff, ...EXIF_HEADER], 0);
  out.set(tiff, 10);
  return out;
}

// ── PNG ──────────────────────────────────────────────────────────────────

const PNG_TEXT = new Set(['tEXt', 'zTXt', 'iTXt']);

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function rewritePng(png: Uint8Array, removal: Removal, report: MetadataReport): Uint8Array | null {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Uint8Array[] = [png.subarray(0, 8)];
  const strict = removal === 'all' || removal === 'camera';
  let i = 8;
  while (i + 12 <= png.length) {
    const length = view.getUint32(i);
    const type = ascii(png, i + 4, 4);
    const end = i + 12 + length;
    if (end > png.length) return null;
    const data = png.subarray(i + 8, i + 8 + length);
    const keep = () => out.push(png.subarray(i, end));
    if (type === 'eXIf') {
      const plan = planExif(data, removal);
      report.fields = plan.block ? describe(plan.block) : [];
      report.removedFields = plan.removed;
      if (removal === 'none') keep();
      else if (plan.out) out.push(pngChunk('eXIf', plan.out));
    } else if (PNG_TEXT.has(type)) {
      const keyword = ascii(data, 0, Math.min(79, data.indexOf(0) < 0 ? 79 : data.indexOf(0)));
      const drop = removal !== 'none' && (strict || placeIn(data));
      report.extras.push({
        label: keyword === 'XML:com.adobe.xmp' ? 'XMP' : `Text “${keyword}”`,
        value: kb(length),
        removed: drop,
      });
      if (!drop) keep();
    } else if (type === 'tIME') {
      report.extras.push({ label: 'Last modified', value: 'Date in the PNG', removed: strict });
      if (!strict) keep();
    } else {
      if (type === 'iCCP')
        report.extras.push({
          label: 'Colour profile',
          value: 'Kept: removing it would change the colours',
          removed: false,
        });
      keep();
    }
    i = end;
    if (type === 'IEND') break;
  }
  if (removal === 'none') return null;
  const size = out.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let at = 0;
  for (const part of out) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

// ── WebP ─────────────────────────────────────────────────────────────────

function rewriteWebp(
  webp: Uint8Array,
  removal: Removal,
  report: MetadataReport,
): Uint8Array | null {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const out: Uint8Array[] = [];
  const strict = removal === 'all' || removal === 'camera';
  let hasExif = false;
  let hasXmp = false;
  let i = 12;
  while (i + 8 <= webp.length) {
    const type = ascii(webp, i, 4);
    const size = view.getUint32(i + 4, true);
    const end = Math.min(webp.length, i + 8 + size + (size % 2));
    const data = webp.subarray(i + 8, i + 8 + size);
    if (type === 'EXIF') {
      const tiff = startsWith(data, 0, EXIF_HEADER) ? data.subarray(6) : data;
      const plan = planExif(tiff, removal);
      report.fields = plan.block ? describe(plan.block) : [];
      report.removedFields = plan.removed;
      const kept = removal === 'none' ? tiff : plan.out;
      if (kept) {
        hasExif = true;
        const chunk = new Uint8Array(8 + kept.length + (kept.length % 2));
        chunk.set([0x45, 0x58, 0x49, 0x46], 0);
        new DataView(chunk.buffer).setUint32(4, kept.length, true);
        chunk.set(kept, 8);
        out.push(chunk);
      }
    } else if (type === 'XMP ') {
      const drop = removal !== 'none' && (strict || placeIn(data));
      report.extras.push({ label: 'XMP', value: kb(size), removed: drop });
      if (!drop) {
        hasXmp = true;
        out.push(webp.subarray(i, end));
      }
    } else {
      if (type === 'ICCP')
        report.extras.push({
          label: 'Colour profile',
          value: 'Kept: removing it would change the colours',
          removed: false,
        });
      out.push(webp.subarray(i, end));
    }
    i = end;
  }
  if (removal === 'none') return null;
  const size = out.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(12 + size);
  result.set(webp.subarray(0, 12), 0);
  new DataView(result.buffer).setUint32(4, 4 + size, true);
  let at = 12;
  for (const part of out) {
    // VP8X's flags say which metadata chunks follow.
    if (ascii(part, 0, 4) === 'VP8X') {
      const flags = part.slice();
      flags[8] = ((flags[8] ?? 0) & ~0x0c) | (hasExif ? 0x08 : 0) | (hasXmp ? 0x04 : 0);
      result.set(flags, at);
    } else {
      result.set(part, at);
    }
    at += part.length;
  }
  return result;
}

// ── Report ───────────────────────────────────────────────────────────────

/** Reads a photo's metadata and, unless `removal` is none, rewrites it without what's chosen. */
export function inspectMetadata(
  bytes: Uint8Array,
  format: ImageFormat,
  removal: Removal,
): MetadataReport {
  const size = headerSize(bytes, format);
  const report: MetadataReport = {
    format,
    ...(size && { width: size.width, height: size.height }),
    fields: [],
    extras: [],
    removedFields: [],
    bytes: null,
  };
  if (format === 'jpeg') report.bytes = rewriteJpeg(bytes, removal, report);
  else if (format === 'png') report.bytes = rewritePng(bytes, removal, report);
  else if (format === 'webp') report.bytes = rewriteWebp(bytes, removal, report);
  return report;
}

const GROUP_TITLES: Record<Group, string> = {
  camera: 'CAMERA',
  settings: 'SETTINGS',
  date: 'DATE',
  location: 'LOCATION',
  people: 'PEOPLE AND RIGHTS',
  other: 'OTHER',
};

export function reportText(report: MetadataReport, removal: Removal, name: string): string {
  const lines: string[] = [
    'FILE',
    `Name              ${name}`,
    `Format            ${FORMAT_LABELS[report.format]}`,
  ];
  if (report.width && report.height) {
    lines.push(`Size              ${String(report.width)} × ${String(report.height)} px`);
  }
  const removed = new Set(report.removedFields.map((f) => `${f.group}:${f.label}`));
  for (const group of Object.keys(GROUP_TITLES) as Group[]) {
    const fields = report.fields.filter((f) => f.group === group);
    if (!fields.length) continue;
    lines.push('', GROUP_TITLES[group]);
    for (const field of fields) {
      const gone = removal !== 'none' && removed.has(`${field.group}:${field.label}`);
      lines.push(`${field.label.padEnd(18)}${field.value}${gone ? '   (removed)' : ''}`);
    }
  }
  if (report.extras.length) {
    lines.push('', 'ALSO IN THE FILE');
    for (const extra of report.extras) {
      const gone = removal !== 'none' && extra.removed;
      lines.push(`${extra.label.padEnd(18)}${extra.value}${gone ? '   (removed)' : ''}`);
    }
  }
  if (!report.fields.length && !report.extras.length) lines.push('', 'No metadata found.');
  return `${lines.join('\n')}\n`;
}

// ── Engine ───────────────────────────────────────────────────────────────

export interface MetadataOptions {
  remove?: string;
}

const REMOVALS: readonly Removal[] = ['all', 'location', 'camera', 'none'];

export const imageMetadataEngine: Engine<MetadataOptions> = {
  capabilities: (caps) => imageCodecEngine.capabilities(caps),
  estimate: (input) => ({ seconds: Math.max(0.2, input.size / 50_000_000) }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const removal = (REMOVALS as readonly string[]).includes(opts.remove ?? '')
      ? (opts.remove as Removal)
      : 'all';
    const source = new Uint8Array(await input.arrayBuffer());
    const format = checkImage(source, input.size);
    const name = input instanceof File ? input.name : 'image';
    ctx.progress(0.2, 'Reading');
    const report = inspectMetadata(source, format, removal);
    const notes: string[] = [];
    let blob: Blob;
    let ext: string;
    let path = 'Browser';
    if (removal === 'none') {
      blob = new Blob([source], { type: input.type || 'application/octet-stream' });
      ext = name.split('.').pop()?.toLowerCase() ?? 'jpg';
      notes.push('Nothing removed: this is your original file');
    } else if (report.bytes) {
      blob = new Blob([report.bytes.slice()], { type: input.type || `image/${format}` });
      ext = format === 'jpeg' ? 'jpg' : format;
      notes.push('Pixels untouched: only the metadata changed');
    } else {
      // HEIC, AVIF, TIFF, GIF, BMP: saved again as PNG, with none.
      const done = await runImageJob(
        {
          ...baseJob(source.slice().buffer, format, { format: 'png', metadata: 'none' }),
          optimise: false,
        },
        ctx.signal,
        (fraction, stage) => {
          ctx.progress(0.2 + fraction * 0.8, stage);
        },
      );
      blob = new Blob([done.bytes], { type: 'image/png' });
      ext = 'png';
      path = 'Browser · WASM';
      notes.push(
        `${FORMAT_LABELS[format]} can't be edited in place here, so it was saved as PNG with no metadata, pixel for pixel`,
      );
    }
    const location = report.fields.filter((f) => f.group === 'location');
    if (removal !== 'none') {
      if (location.length) {
        notes.unshift('GPS location removed');
      }
      const count = report.removedFields.length + report.extras.filter((e) => e.removed).length;
      if (count === 0 && report.bytes) notes.push('There was nothing of that kind to remove');
    }
    const camera = report.fields
      .filter((f) => f.group === 'camera' && (f.label === 'Make' || f.label === 'Model'))
      .map((f) => f.value);
    const taken = report.fields.find((f) => f.label === 'Taken')?.value;
    return {
      blob,
      ext,
      path,
      notes,
      details: [
        { label: 'Camera', value: camera.length ? [...new Set(camera)].join(' ') : 'Not recorded' },
        { label: 'Taken', value: taken ?? 'Not recorded' },
        { label: 'Location', value: location[0]?.value ?? 'None' },
        {
          label: removal === 'none' ? 'Fields' : 'Removed',
          value:
            removal === 'none'
              ? String(report.fields.length + report.extras.length)
              : `${String(report.removedFields.length + report.extras.filter((e) => e.removed).length)} of ${String(report.fields.length + report.extras.length)}`,
        },
      ],
      report: reportText(report, removal, name),
    };
  },
};
