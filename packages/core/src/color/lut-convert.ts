/**
 * C06 LUT Converter (tools/color.md): `.cube` ↔ `.3dl`, the grid resampled
 * to 17, 33 or 65 points, and 1D ↔ 3D where that's exact. Resampling reads
 * the source with the same tetrahedral lookup LUT Preview applies, so a
 * resized LUT grades the same between the old grid points.
 *
 * `.3dl` is Autodesk's (Lustre, Flame, Nuke): an input mesh line (the grid,
 * as 10-bit codes 0–1023), then one line of integer RGB per grid point with
 * blue changing fastest. Its output depth is the one Lustre's `Mesh N B`
 * header states (B bits), or else read from the largest value (10, 12 or
 * 16 bit), and it's written as 12 bit, the common choice.
 */
import { LutError, lookup, type Lut } from './lut';

const MAX_3D = 256;
/** A 3D grid made from a 1D LUT or resized: the sizes grading apps use. */
export const GRID_SIZES = [17, 33, 65] as const;

const DEPTHS = [10, 12, 16] as const;

/** Reads an Autodesk `.3dl`: an input mesh line (optional), then N³ integer RGB lines, blue fastest. */
export function parse3dl(text: string): Lut {
  const rows: { values: number[]; line: number }[] = [];
  /** The output depth Lustre's "Mesh N B" line states, in bits. */
  let stated: number | null = null;
  for (const [i, raw] of text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .entries()) {
    const hash = raw.indexOf('#');
    const content = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    // Lustre's "Mesh 4 12": a 2⁴ + 1 point input mesh (the mesh line says it too) and 12-bit output.
    const mesh = /^Mesh\s+\d+\s+(\d+)\b/i.exec(content);
    const bits = Number(mesh?.[1]);
    if (mesh && Number.isInteger(bits) && bits >= 8 && bits <= 16) stated = bits;
    // That line, "3DMESH" and the rest of Lustre's header are skipped.
    if (!content || /^(3DMESH|Mesh|LUT8|gamma)\b/i.test(content)) continue;
    const values = content.split(/\s+/).map(Number);
    if (values.some((v) => !Number.isFinite(v))) {
      throw new LutError('expected whole numbers: this isn’t a .3dl LUT', i + 1);
    }
    rows.push({ values, line: i + 1 });
  }
  const first = rows[0];
  if (!first) throw new LutError('no values: this isn’t a .3dl LUT', 0);
  // The mesh line: N codes for an N³ grid, rising from 0. A 3-point mesh looks like a value
  // line, so it's told by the count of lines after it, or by rising from 0 when the lines
  // don't make a cube without it.
  const rising = first.values.every((v, i, all) => (i === 0 ? v === 0 : v > (all[i - 1] ?? 0)));
  const side = Math.round(Math.cbrt(rows.length));
  const mesh =
    first.values.length !== 3 ||
    rows.length - 1 === first.values.length ** 3 ||
    (rising && side ** 3 !== rows.length)
      ? first.values
      : null;
  const body = mesh ? rows.slice(1) : rows;
  const size = mesh ? mesh.length : Math.round(Math.cbrt(body.length));
  if (size < 2 || size > MAX_3D) {
    throw new LutError(`the grid must be 2 to ${String(MAX_3D)} points a side`, first.line);
  }
  if (body.length !== size ** 3) {
    throw new LutError(
      `${String(body.length)} values, but a ${String(size)}³ LUT needs ${String(size ** 3)}`,
      0,
    );
  }
  let max = 0;
  for (const row of body) {
    if (row.values.length !== 3) throw new LutError('expected three numbers', row.line);
    max = Math.max(max, ...row.values);
  }
  // The stated depth, unless the values don't fit it; then the depth they fit, as without one.
  const depth =
    stated !== null && max <= 2 ** stated - 1
      ? stated
      : (DEPTHS.find((bits) => max <= 2 ** bits - 1) ?? 16);
  const scale = 2 ** depth - 1;
  const table = new Float32Array(size ** 3 * 3);
  // File order: red slowest, blue fastest. Table order: red fastest.
  body.forEach((row, i) => {
    const b = i % size;
    const g = Math.floor(i / size) % size;
    const r = Math.floor(i / (size * size));
    const at = ((b * size + g) * size + r) * 3;
    table[at] = (row.values[0] ?? 0) / scale;
    table[at + 1] = (row.values[1] ?? 0) / scale;
    table[at + 2] = (row.values[2] ?? 0) / scale;
  });
  return {
    title: '',
    dimensions: 3,
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    table,
  };
}

const num = (v: number) => {
  const fixed = v.toFixed(6);
  return fixed === '-0.000000' ? '0.000000' : fixed;
};

/** Writes a `.cube` (Adobe/Resolve), 1D or 3D, red changing fastest. */
export function formatCube(lut: Lut, title: string): string {
  const lines = [`TITLE "${title.replace(/"/g, "'")}"`];
  lines.push(`${lut.dimensions === 3 ? 'LUT_3D_SIZE' : 'LUT_1D_SIZE'} ${String(lut.size)}`);
  const plain = lut.domainMin.every((v) => v === 0) && lut.domainMax.every((v) => v === 1);
  if (!plain) {
    lines.push(`DOMAIN_MIN ${lut.domainMin.map(num).join(' ')}`);
    lines.push(`DOMAIN_MAX ${lut.domainMax.map(num).join(' ')}`);
  }
  for (let i = 0; i < lut.table.length; i += 3) {
    lines.push(
      `${num(lut.table[i] ?? 0)} ${num(lut.table[i + 1] ?? 0)} ${num(lut.table[i + 2] ?? 0)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** A 3D LUT over the plain 0–1 domain, `size` points a side, read from `lut` (1D or 3D). */
export function resample(lut: Lut, size: number): Lut {
  if (!Number.isInteger(size) || size < 2 || size > MAX_3D) {
    throw new RangeError(`A grid of 2 to ${String(MAX_3D)} points`);
  }
  const table = new Float32Array(size ** 3 * 3);
  const out = new Float32Array(3);
  let i = 0;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        lookup(lut, r / (size - 1), g / (size - 1), b / (size - 1), out);
        table.set(out, i);
        i += 3;
      }
    }
  }
  return {
    title: lut.title,
    dimensions: 3,
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    table,
  };
}

/**
 * A 3D LUT as three curves, when it is one: each channel's output depends
 * on its own input only (within `tolerance`). Null when the cube mixes
 * channels (saturation, hue shifts), which no 1D LUT can do.
 */
export function to1d(lut: Lut, tolerance = 1e-3): Lut | null {
  if (lut.dimensions === 1) return lut;
  const s = lut.size;
  const t = lut.table;
  const at = (r: number, g: number, b: number) => ((b * s + g) * s + r) * 3;
  const table = new Float32Array(s * 3);
  for (let i = 0; i < s; i += 1) {
    table[i * 3] = t[at(i, 0, 0)] ?? 0;
    table[i * 3 + 1] = t[at(0, i, 0) + 1] ?? 0;
    table[i * 3 + 2] = t[at(0, 0, i) + 2] ?? 0;
  }
  for (let b = 0; b < s; b += 1) {
    for (let g = 0; g < s; g += 1) {
      for (let r = 0; r < s; r += 1) {
        const k = at(r, g, b);
        if (
          Math.abs((t[k] ?? 0) - (table[r * 3] ?? 0)) > tolerance ||
          Math.abs((t[k + 1] ?? 0) - (table[g * 3 + 1] ?? 0)) > tolerance ||
          Math.abs((t[k + 2] ?? 0) - (table[b * 3 + 2] ?? 0)) > tolerance
        ) {
          return null;
        }
      }
    }
  }
  return { ...lut, dimensions: 1, table };
}

/** Writes an Autodesk `.3dl`: a 10-bit input mesh, then 12-bit RGB, blue fastest. Values outside 0–1 are clipped. */
export function format3dl(lut: Lut): { text: string; clipped: number } {
  const cube =
    lut.dimensions === 3 &&
    lut.domainMin.every((v) => v === 0) &&
    lut.domainMax.every((v) => v === 1)
      ? lut
      : resample(lut, lut.dimensions === 3 ? lut.size : 33);
  const s = cube.size;
  const lines = [
    Array.from({ length: s }, (_, i) => String(Math.round((i * 1023) / (s - 1)))).join(' '),
  ];
  let clipped = 0;
  const code = (v: number) => {
    if (v < 0 || v > 1) clipped += 1;
    return String(Math.round(Math.min(1, Math.max(0, v)) * 4095));
  };
  for (let r = 0; r < s; r += 1) {
    for (let g = 0; g < s; g += 1) {
      for (let b = 0; b < s; b += 1) {
        const k = ((b * s + g) * s + r) * 3;
        lines.push(
          `${code(cube.table[k] ?? 0)} ${code(cube.table[k + 1] ?? 0)} ${code(cube.table[k + 2] ?? 0)}`,
        );
      }
    }
  }
  return { text: `${lines.join('\n')}\n`, clipped };
}
