/**
 * C05 LUT Preview (tools/color.md): `.cube` LUTs read and applied to RGBA
 * pixels. 3D LUTs use tetrahedral interpolation (the one grading apps use:
 * exact on the grey axis, no colour casts between grid points), 1D LUTs a
 * straight line between entries. Pure, so it runs in a worker and in tests.
 */

export interface Lut {
  title: string;
  /** 1 (a curve per channel) or 3 (a cube). */
  dimensions: 1 | 3;
  /** Points per axis. */
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** RGB triples: for 3D, red changing fastest, then green, then blue. */
  table: Float32Array;
}

/** A `.cube` file that can't be read, with the line where it went wrong. */
export class LutError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(line > 0 ? `Line ${String(line)}: ${message}` : message);
    this.line = line;
  }
}

const MAX_3D = 256;
const MAX_1D = 65_536;

/** Reads a `.cube` file (Adobe/Resolve): 1D or 3D, with an optional domain. */
export function parseCube(text: string): Lut {
  let title = '';
  let dimensions: 1 | 3 | null = null;
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let table: Float32Array | null = null;
  let filled = 0;
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const triple = (parts: string[], line: number): [number, number, number] => {
    const values = parts.map(Number);
    if (values.length !== 3 || values.some((v) => !Number.isFinite(v))) {
      throw new LutError('expected three numbers', line);
    }
    return values as [number, number, number];
  };
  for (const [i, raw] of lines.entries()) {
    const line = i + 1;
    const content = raw.replace(/#.*$/, '').trim();
    if (!content) continue;
    const parts = content.split(/\s+/);
    const key = (parts[0] ?? '').toUpperCase();
    if (key === 'TITLE') {
      title = content.slice(5).trim().replace(/^"|"$/g, '');
    } else if (key === 'LUT_3D_SIZE' || key === 'LUT_1D_SIZE') {
      if (dimensions) throw new LutError('a second LUT size', line);
      const n = Number(parts[1]);
      const is3d = key === 'LUT_3D_SIZE';
      if (!Number.isInteger(n) || n < 2 || n > (is3d ? MAX_3D : MAX_1D)) {
        throw new LutError(
          `the size must be a whole number from 2 to ${String(is3d ? MAX_3D : MAX_1D)}`,
          line,
        );
      }
      dimensions = is3d ? 3 : 1;
      size = n;
      table = new Float32Array((is3d ? n * n * n : n) * 3);
    } else if (key === 'DOMAIN_MIN') {
      domainMin = triple(parts.slice(1), line);
    } else if (key === 'DOMAIN_MAX') {
      domainMax = triple(parts.slice(1), line);
    } else if (key === 'LUT_1D_INPUT_RANGE' || key === 'LUT_3D_INPUT_RANGE') {
      const [lo, hi] = parts.slice(1).map(Number);
      if (lo === undefined || hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi)) {
        throw new LutError('expected two numbers', line);
      }
      domainMin = [lo, lo, lo];
      domainMax = [hi, hi, hi];
    } else if (/^[-+.\d]/.test(key)) {
      if (!table) throw new LutError('values before LUT_3D_SIZE or LUT_1D_SIZE', line);
      if (filled * 3 >= table.length) throw new LutError('more values than the size says', line);
      table.set(triple(parts, line), filled * 3);
      filled += 1;
    } else {
      throw new LutError(`unknown keyword “${parts[0] ?? ''}”`, line);
    }
  }
  if (!table || !dimensions)
    throw new LutError('no LUT_3D_SIZE or LUT_1D_SIZE: this isn’t a .cube LUT', 0);
  if (filled * 3 !== table.length) {
    throw new LutError(
      `${String(filled)} values, but a ${dimensions === 3 ? `${String(size)}³` : String(size)} LUT needs ${String(table.length / 3)}`,
      0,
    );
  }
  for (let c = 0; c < 3; c += 1) {
    if ((domainMax[c] ?? 1) <= (domainMin[c] ?? 0))
      throw new LutError('DOMAIN_MAX must be above DOMAIN_MIN', 0);
  }
  return { title, dimensions, size, domainMin, domainMax, table };
}

/** The identity cube of a size: every colour maps to itself. */
export function identityLut(size: number): Lut {
  const table = new Float32Array(size * size * size * 3);
  let i = 0;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        table[i] = r / (size - 1);
        table[i + 1] = g / (size - 1);
        table[i + 2] = b / (size - 1);
        i += 3;
      }
    }
  }
  return {
    title: 'Identity',
    dimensions: 3,
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    table,
  };
}

/** One colour (0–1 each) through the LUT, into `out`. */
export function lookup(lut: Lut, r: number, g: number, b: number, out: Float32Array): void {
  const n = lut.size - 1;
  const t = lut.table;
  const scale = (v: number, c: number) => {
    const lo = lut.domainMin[c] ?? 0;
    const hi = lut.domainMax[c] ?? 1;
    const x = ((v - lo) / (hi - lo)) * n;
    return x < 0 ? 0 : x > n ? n : x;
  };
  const x = scale(r, 0);
  const y = scale(g, 1);
  const z = scale(b, 2);
  if (lut.dimensions === 1) {
    for (let c = 0; c < 3; c += 1) {
      const p = c === 0 ? x : c === 1 ? y : z;
      const i = Math.min(Math.floor(p), n - 1);
      const f = p - i;
      out[c] = (t[i * 3 + c] ?? 0) * (1 - f) + (t[(i + 1) * 3 + c] ?? 0) * f;
    }
    return;
  }
  const s = lut.size;
  const x0 = Math.min(Math.floor(x), n - 1);
  const y0 = Math.min(Math.floor(y), n - 1);
  const z0 = Math.min(Math.floor(z), n - 1);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const at = (dx: number, dy: number, dz: number) =>
    ((z0 + dz) * s * s + (y0 + dy) * s + (x0 + dx)) * 3;
  const c000 = at(0, 0, 0);
  const c111 = at(1, 1, 1);
  // The tetrahedron the point is in, by the order of its fractions.
  let a: number;
  let b2: number;
  let w0: number;
  let w1: number;
  let w2: number;
  let w3: number;
  if (fx >= fy) {
    if (fy >= fz) {
      a = at(1, 0, 0);
      b2 = at(1, 1, 0);
      [w0, w1, w2, w3] = [1 - fx, fx - fy, fy - fz, fz];
    } else if (fx >= fz) {
      a = at(1, 0, 0);
      b2 = at(1, 0, 1);
      [w0, w1, w2, w3] = [1 - fx, fx - fz, fz - fy, fy];
    } else {
      a = at(0, 0, 1);
      b2 = at(1, 0, 1);
      [w0, w1, w2, w3] = [1 - fz, fz - fx, fx - fy, fy];
    }
  } else if (fz >= fy) {
    a = at(0, 0, 1);
    b2 = at(0, 1, 1);
    [w0, w1, w2, w3] = [1 - fz, fz - fy, fy - fx, fx];
  } else if (fz >= fx) {
    a = at(0, 1, 0);
    b2 = at(0, 1, 1);
    [w0, w1, w2, w3] = [1 - fy, fy - fz, fz - fx, fx];
  } else {
    a = at(0, 1, 0);
    b2 = at(1, 1, 0);
    [w0, w1, w2, w3] = [1 - fy, fy - fx, fx - fz, fz];
  }
  for (let c = 0; c < 3; c += 1) {
    out[c] =
      w0 * (t[c000 + c] ?? 0) +
      w1 * (t[a + c] ?? 0) +
      w2 * (t[b2 + c] ?? 0) +
      w3 * (t[c111 + c] ?? 0);
  }
}

/**
 * RGBA pixels through the LUT, in place, blended with the original by
 * `intensity` (0–1). Alpha is kept; results round to the nearest of 256
 * levels. Each channel's 256 input levels are placed on the grid once, so
 * the loop does no allocation and no division.
 */
export function applyLut(pixels: Uint8ClampedArray, lut: Lut, intensity = 1): void {
  const k = Math.min(1, Math.max(0, intensity));
  const n = lut.size - 1;
  const t = lut.table;
  // Grid cell and fraction for every 8-bit level, per channel.
  const cell = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
  const frac = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  for (let c = 0; c < 3; c += 1) {
    const lo = lut.domainMin[c] ?? 0;
    const hi = lut.domainMax[c] ?? 1;
    for (let v = 0; v < 256; v += 1) {
      let x = ((v / 255 - lo) / (hi - lo)) * n;
      x = x < 0 ? 0 : x > n ? n : x;
      const i = Math.min(Math.floor(x), n - 1);
      (cell[c] as Int32Array)[v] = i;
      (frac[c] as Float32Array)[v] = x - i;
    }
  }
  const [cr, cg, cb] = cell as [Int32Array, Int32Array, Int32Array];
  const [fr, fg, fb] = frac as [Float32Array, Float32Array, Float32Array];
  const s = lut.size;
  const sx = 3;
  const sy = s * 3;
  const sz = s * s * 3;
  for (let i = 0; i < pixels.length; i += 4) {
    const r8 = pixels[i] ?? 0;
    const g8 = pixels[i + 1] ?? 0;
    const b8 = pixels[i + 2] ?? 0;
    let o0: number;
    let o1: number;
    let o2: number;
    if (lut.dimensions === 1) {
      const ir = (cr[r8] ?? 0) * 3;
      const ig = (cg[g8] ?? 0) * 3;
      const ib = (cb[b8] ?? 0) * 3;
      const xr = fr[r8] ?? 0;
      const xg = fg[g8] ?? 0;
      const xb = fb[b8] ?? 0;
      o0 = (t[ir] ?? 0) * (1 - xr) + (t[ir + 3] ?? 0) * xr;
      o1 = (t[ig + 1] ?? 0) * (1 - xg) + (t[ig + 4] ?? 0) * xg;
      o2 = (t[ib + 2] ?? 0) * (1 - xb) + (t[ib + 5] ?? 0) * xb;
    } else {
      const fx = fr[r8] ?? 0;
      const fy = fg[g8] ?? 0;
      const fz = fb[b8] ?? 0;
      const base = (cb[b8] ?? 0) * sz + (cg[g8] ?? 0) * sy + (cr[r8] ?? 0) * sx;
      // The two corners between c000 and c111, and the four weights, by the order of the fractions.
      let a: number;
      let b: number;
      let w0: number;
      let w1: number;
      let w2: number;
      let w3: number;
      if (fx >= fy) {
        if (fy >= fz) {
          a = base + sx;
          b = base + sx + sy;
          w0 = 1 - fx;
          w1 = fx - fy;
          w2 = fy - fz;
          w3 = fz;
        } else if (fx >= fz) {
          a = base + sx;
          b = base + sx + sz;
          w0 = 1 - fx;
          w1 = fx - fz;
          w2 = fz - fy;
          w3 = fy;
        } else {
          a = base + sz;
          b = base + sx + sz;
          w0 = 1 - fz;
          w1 = fz - fx;
          w2 = fx - fy;
          w3 = fy;
        }
      } else if (fz >= fy) {
        a = base + sz;
        b = base + sy + sz;
        w0 = 1 - fz;
        w1 = fz - fy;
        w2 = fy - fx;
        w3 = fx;
      } else if (fz >= fx) {
        a = base + sy;
        b = base + sy + sz;
        w0 = 1 - fy;
        w1 = fy - fz;
        w2 = fz - fx;
        w3 = fx;
      } else {
        a = base + sy;
        b = base + sx + sy;
        w0 = 1 - fy;
        w1 = fy - fx;
        w2 = fx - fz;
        w3 = fz;
      }
      const c = base + sx + sy + sz;
      o0 = w0 * (t[base] ?? 0) + w1 * (t[a] ?? 0) + w2 * (t[b] ?? 0) + w3 * (t[c] ?? 0);
      o1 =
        w0 * (t[base + 1] ?? 0) +
        w1 * (t[a + 1] ?? 0) +
        w2 * (t[b + 1] ?? 0) +
        w3 * (t[c + 1] ?? 0);
      o2 =
        w0 * (t[base + 2] ?? 0) +
        w1 * (t[a + 2] ?? 0) +
        w2 * (t[b + 2] ?? 0) +
        w3 * (t[c + 2] ?? 0);
    }
    pixels[i] = Math.round((o0 * k + (r8 / 255) * (1 - k)) * 255);
    pixels[i + 1] = Math.round((o1 * k + (g8 / 255) * (1 - k)) * 255);
    pixels[i + 2] = Math.round((o2 * k + (b8 / 255) * (1 - k)) * 255);
  }
}
