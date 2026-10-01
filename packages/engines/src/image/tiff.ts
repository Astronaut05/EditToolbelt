/**
 * EXIF as data (P15 Photo Metadata Viewer & Remover): read every entry of a
 * TIFF block's main, Exif and GPS directories, say what each one means, and
 * write a new block with only the entries kept. Values keep their original
 * bytes and byte order; the thumbnail (IFD1) and the maker's private notes
 * are never written back, since moving them can break their inner offsets.
 */

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

export const POINTER_EXIF = 0x8769;
export const POINTER_GPS = 0x8825;
export const POINTER_INTEROP = 0xa005;
export const TAG_ORIENTATION = 0x0112;
export const TAG_MAKER_NOTE = 0x927c;

export type Directory = 'ifd0' | 'exif' | 'gps';

export interface TiffEntry {
  dir: Directory;
  tag: number;
  type: number;
  count: number;
  /** The value's bytes, as stored (in the block's byte order). */
  value: Uint8Array;
}

export interface TiffBlock {
  le: boolean;
  entries: TiffEntry[];
  /** IFD1 is there: a small JPEG preview of the photo. */
  thumbnail: boolean;
}

/** Reads a TIFF block, or null when it isn't one. Bad offsets end a directory early, never throw. */
export function readTiff(tiff: Uint8Array): TiffBlock | null {
  if (tiff.length < 8) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const order = String.fromCharCode(tiff[0] ?? 0, tiff[1] ?? 0);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (at: number) => view.getUint16(at, le);
  const u32 = (at: number) => view.getUint32(at, le);
  if (u16(2) !== 42) return null;
  const inside = (at: number, length: number) => at >= 0 && at + length <= tiff.length;

  const entries: TiffEntry[] = [];
  const seen = new Set<number>();
  /** Reads one directory; answers the next directory's offset and its pointers. */
  const readDir = (at: number, dir: Directory) => {
    const pointers: { exif?: number; gps?: number } = {};
    if (seen.has(at) || !inside(at, 2)) return { next: 0, pointers };
    seen.add(at);
    const count = u16(at);
    if (!inside(at + 2, count * 12 + 4)) return { next: 0, pointers };
    for (let n = 0; n < count; n += 1) {
      const entry = at + 2 + n * 12;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const itemCount = u32(entry + 4);
      const size = (TYPE_SIZES[type] ?? 0) * itemCount;
      if (dir === 'ifd0' && tag === POINTER_EXIF) {
        pointers.exif = u32(entry + 8);
        continue;
      }
      if (dir === 'ifd0' && tag === POINTER_GPS) {
        pointers.gps = u32(entry + 8);
        continue;
      }
      if (dir === 'exif' && tag === POINTER_INTEROP) continue;
      if (size === 0 || size > 1 << 20) continue;
      const start = size <= 4 ? entry + 8 : u32(entry + 8);
      if (!inside(start, size)) continue;
      entries.push({ dir, tag, type, count: itemCount, value: tiff.slice(start, start + size) });
    }
    return { next: u32(at + 2 + count * 12), pointers };
  };

  const first = readDir(u32(4), 'ifd0');
  if (first.pointers.exif) readDir(first.pointers.exif, 'exif');
  if (first.pointers.gps) readDir(first.pointers.gps, 'gps');
  return { le, entries, thumbnail: first.next > 0 && inside(first.next, 2) };
}

/** A new TIFF block with `entries` (pointers rebuilt, no thumbnail); null when there's nothing to write. */
export function writeTiff(le: boolean, entries: readonly TiffEntry[]): Uint8Array | null {
  const dirs: Record<Directory, TiffEntry[]> = { ifd0: [], exif: [], gps: [] };
  for (const entry of entries) {
    if (entry.tag !== TAG_MAKER_NOTE) dirs[entry.dir].push(entry);
  }
  for (const list of Object.values(dirs)) list.sort((a, b) => a.tag - b.tag);
  if (dirs.ifd0.length + dirs.exif.length + dirs.gps.length === 0) return null;

  const ifd0Count = dirs.ifd0.length + (dirs.exif.length ? 1 : 0) + (dirs.gps.length ? 1 : 0);
  const dirSize = (count: number) => 2 + count * 12 + 4;
  const ifd0At = 8;
  const exifAt = ifd0At + dirSize(ifd0Count);
  const gpsAt = exifAt + (dirs.exif.length ? dirSize(dirs.exif.length) : 0);
  let dataAt = gpsAt + (dirs.gps.length ? dirSize(dirs.gps.length) : 0);
  const big = (list: TiffEntry[]) => list.filter((e) => e.value.length > 4);
  const dataSize = [...big(dirs.ifd0), ...big(dirs.exif), ...big(dirs.gps)].reduce(
    (sum, e) => sum + e.value.length + (e.value.length % 2),
    0,
  );
  const out = new Uint8Array(dataAt + dataSize);
  const view = new DataView(out.buffer);
  out.set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  view.setUint16(2, 42, le);
  view.setUint32(4, ifd0At, le);

  const writeDir = (at: number, list: TiffEntry[], pointers: [number, number][] = []) => {
    const all = [
      ...list.map((e) => ({ tag: e.tag, entry: e, pointer: 0 })),
      ...pointers.map(([tag, pointer]) => ({ tag, entry: null, pointer })),
    ].sort((a, b) => a.tag - b.tag);
    view.setUint16(at, all.length, le);
    all.forEach((item, n) => {
      const slot = at + 2 + n * 12;
      view.setUint16(slot, item.tag, le);
      if (!item.entry) {
        view.setUint16(slot + 2, 4, le);
        view.setUint32(slot + 4, 1, le);
        view.setUint32(slot + 8, item.pointer, le);
        return;
      }
      const { type, count, value } = item.entry;
      view.setUint16(slot + 2, type, le);
      view.setUint32(slot + 4, count, le);
      if (value.length <= 4) {
        out.set(value, slot + 8);
      } else {
        view.setUint32(slot + 8, dataAt, le);
        out.set(value, dataAt);
        dataAt += value.length + (value.length % 2);
      }
    });
    view.setUint32(at + 2 + all.length * 12, 0, le);
  };

  const pointers: [number, number][] = [];
  if (dirs.exif.length) pointers.push([POINTER_EXIF, exifAt]);
  if (dirs.gps.length) pointers.push([POINTER_GPS, gpsAt]);
  writeDir(ifd0At, dirs.ifd0, pointers);
  if (dirs.exif.length) writeDir(exifAt, dirs.exif);
  if (dirs.gps.length) writeDir(gpsAt, dirs.gps);
  return out;
}

// ── Values ───────────────────────────────────────────────────────────────

function numbers(entry: TiffEntry, le: boolean): number[] {
  const view = new DataView(entry.value.buffer, entry.value.byteOffset, entry.value.byteLength);
  const out: number[] = [];
  for (let i = 0; i < entry.count; i += 1) {
    switch (entry.type) {
      case 1:
      case 7:
        out.push(view.getUint8(i));
        break;
      case 3:
        out.push(view.getUint16(i * 2, le));
        break;
      case 4:
        out.push(view.getUint32(i * 4, le));
        break;
      case 8:
        out.push(view.getInt16(i * 2, le));
        break;
      case 9:
        out.push(view.getInt32(i * 4, le));
        break;
      case 5: {
        const den = view.getUint32(i * 8 + 4, le);
        out.push(den ? view.getUint32(i * 8, le) / den : 0);
        break;
      }
      case 10: {
        const den = view.getInt32(i * 8 + 4, le);
        out.push(den ? view.getInt32(i * 8, le) / den : 0);
        break;
      }
      default:
        return out;
    }
  }
  return out;
}

function text(entry: TiffEntry): string {
  // UserComment starts with an 8-byte character code ("ASCII\0\0\0").
  const bytes = entry.tag === 0x9286 ? entry.value.subarray(8) : entry.value;
  return (
    new TextDecoder('utf-8', { fatal: false })
      .decode(bytes)
      .split('')
      // Control characters other than tab and newline: NULs, padding.
      .filter((char) => char === '\t' || char === '\n' || char.charCodeAt(0) >= 0x20)
      .join('')
      .trim()
  );
}

const round = (value: number, digits: number) => String(Number(value.toFixed(digits)));

function exposure(seconds: number): string {
  if (seconds <= 0) return '';
  return seconds >= 1 ? `${round(seconds, 1)} s` : `1/${String(Math.round(1 / seconds))} s`;
}

/** A GPS coordinate (degrees, minutes, seconds) as signed decimal degrees. */
function degrees(dms: number[], ref: string): number | null {
  if (dms.length < 3) return null;
  const value = (dms[0] ?? 0) + (dms[1] ?? 0) / 60 + (dms[2] ?? 0) / 3600;
  return ref === 'S' || ref === 'W' ? -value : value;
}

export type Group = 'camera' | 'settings' | 'date' | 'location' | 'people' | 'other';

export interface Field {
  group: Group;
  label: string;
  value: string;
}

interface Known {
  group: Group;
  label: string;
  show?: (entry: TiffEntry, le: boolean) => string;
}

const ORIENTATIONS = [
  '',
  'Normal',
  'Mirrored',
  'Upside down',
  'Upside down, mirrored',
  'Turned, mirrored',
  'Turned 90° right',
  'Turned, mirrored',
  'Turned 90° left',
];

const KNOWN: Record<Directory, Record<number, Known>> = {
  ifd0: {
    0x010e: { group: 'people', label: 'Description' },
    0x010f: { group: 'camera', label: 'Make' },
    0x0110: { group: 'camera', label: 'Model' },
    0x0112: {
      group: 'other',
      label: 'Orientation',
      show: (e, le) => ORIENTATIONS[numbers(e, le)[0] ?? 0] ?? '',
    },
    0x0131: { group: 'other', label: 'Software' },
    0x0132: { group: 'date', label: 'Modified' },
    0x013b: { group: 'people', label: 'Artist' },
    0x013c: { group: 'people', label: 'Computer' },
    0x8298: { group: 'people', label: 'Copyright' },
  },
  exif: {
    0x829a: {
      group: 'settings',
      label: 'Exposure',
      show: (e, le) => exposure(numbers(e, le)[0] ?? 0),
    },
    0x829d: {
      group: 'settings',
      label: 'Aperture',
      show: (e, le) => `f/${round(numbers(e, le)[0] ?? 0, 1)}`,
    },
    0x8827: { group: 'settings', label: 'ISO', show: (e, le) => String(numbers(e, le)[0] ?? '') },
    0x9003: { group: 'date', label: 'Taken' },
    0x9004: { group: 'date', label: 'Digitized' },
    0x9010: { group: 'date', label: 'Time zone' },
    0x9011: { group: 'date', label: 'Time zone (taken)' },
    0x9204: {
      group: 'settings',
      label: 'Exposure bias',
      show: (e, le) => `${round(numbers(e, le)[0] ?? 0, 2)} EV`,
    },
    0x9209: {
      group: 'settings',
      label: 'Flash',
      show: (e, le) => ((numbers(e, le)[0] ?? 0) & 1 ? 'Fired' : 'Did not fire'),
    },
    0x920a: {
      group: 'settings',
      label: 'Focal length',
      show: (e, le) => `${round(numbers(e, le)[0] ?? 0, 1)} mm`,
    },
    0x9286: { group: 'people', label: 'Comment' },
    0x927c: {
      group: 'other',
      label: 'Maker notes',
      show: (e) => `${String(e.value.length)} bytes`,
    },
    0xa405: {
      group: 'settings',
      label: 'Focal length (35 mm)',
      show: (e, le) => `${String(numbers(e, le)[0] ?? '')} mm`,
    },
    0xa420: { group: 'people', label: 'Unique ID' },
    0xa430: { group: 'people', label: 'Owner' },
    0xa431: { group: 'people', label: 'Camera serial number' },
    0xa433: { group: 'camera', label: 'Lens make' },
    0xa434: { group: 'camera', label: 'Lens' },
    0xa435: { group: 'people', label: 'Lens serial number' },
  },
  gps: {},
};

/** Tags a photographer usually wants to keep: what took it and how (mode "Keep camera and settings"). */
export function isCameraOrSettings(entry: TiffEntry): boolean {
  if (entry.dir === 'gps' || entry.tag === TAG_MAKER_NOTE) return false;
  const known = KNOWN[entry.dir][entry.tag];
  if (known) return known.group === 'camera' || known.group === 'settings';
  // Unnamed Exif entries describing the exposure (metering, white balance, colour space…).
  return entry.dir === 'exif' && entry.tag >= 0x8822 && entry.tag <= 0xa40c && entry.tag !== 0x9286;
}

/** The fields worth showing, by group; GPS turned into readable coordinates. */
export function describe(block: TiffBlock): Field[] {
  const fields: Field[] = [];
  for (const entry of block.entries) {
    if (entry.dir === 'gps') continue;
    const known = KNOWN[entry.dir][entry.tag];
    if (!known) continue;
    const value = known.show
      ? known.show(entry, block.le)
      : entry.type === 2 || entry.type === 7
        ? text(entry)
        : '';
    if (value) fields.push({ group: known.group, label: known.label, value });
  }
  const gps = (tag: number) => block.entries.find((e) => e.dir === 'gps' && e.tag === tag);
  const latitude = gps(2);
  const longitude = gps(4);
  if (latitude && longitude) {
    const lat = degrees(numbers(latitude, block.le), text(gps(1) ?? latitude).slice(0, 1));
    const lon = degrees(numbers(longitude, block.le), text(gps(3) ?? longitude).slice(0, 1));
    if (lat !== null && lon !== null) {
      fields.push({
        group: 'location',
        label: 'Coordinates',
        value: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
      });
    }
  }
  const altitude = gps(6);
  if (altitude) {
    const below = (numbers(gps(5) ?? altitude, block.le)[0] ?? 0) === 1 && gps(5) !== undefined;
    fields.push({
      group: 'location',
      label: 'Altitude',
      value: `${below ? '-' : ''}${round(numbers(altitude, block.le)[0] ?? 0, 1)} m`,
    });
  }
  const others = block.entries.filter(
    (e) => e.dir === 'gps' && ![1, 2, 3, 4, 5, 6].includes(e.tag),
  );
  if (others.length) {
    fields.push({
      group: 'location',
      label: 'Other GPS fields',
      value: String(others.length),
    });
  }
  return fields;
}
