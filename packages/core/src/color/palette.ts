/**
 * C01 palette extraction (tools/color.md): k-means in Oklab on a histogram of
 * the image's pixels, so the maths is perceptual and fast on any size. Pure,
 * shared with the Premiere panel. Exports: CSS variables, JSON and Adobe
 * Swatch Exchange (ASE).
 */
import { formats, oklabToRgb, rgbToOklab, toBytes, toHex, type Oklab, type Rgb } from './color';

export type PaletteMethod = 'dominant' | 'vibrant' | 'muted';

export interface Swatch {
  rgb: Rgb;
  hex: string;
  /** Share of the counted pixels, 0-1. */
  share: number;
}

export interface PaletteOptions {
  /** 3-12 colours. */
  count: number;
  method?: PaletteMethod;
  /** Leave out near-white and near-black pixels (a plain background, deep shadows). */
  ignoreExtremes?: boolean;
}

/** Colours closer than this in Oklab are one colour (a ΔE of about 2 in Lab). */
const SAME = 0.02;

interface Point {
  l: number;
  a: number;
  b: number;
  weight: number;
}

const chroma = (p: { a: number; b: number }) => Math.hypot(p.a, p.b);
const distance2 = (x: Oklab, y: Oklab) => (x.l - y.l) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2;

/** Pixels binned by colour: each bin's mean Oklab and pixel count. Exact colours survive. */
function histogram(rgba: ArrayLike<number>, ignoreExtremes: boolean): Point[] {
  const bins = new Map<number, Point & { r: number; g: number; bl: number }>();
  const add = (skipExtremes: boolean) => {
    for (let i = 0; i < rgba.length; i += 4) {
      if ((rgba[i + 3] ?? 0) < 128) continue;
      const r = rgba[i] ?? 0;
      const g = rgba[i + 1] ?? 0;
      const b = rgba[i + 2] ?? 0;
      if (skipExtremes) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        // Near-white (light and nearly grey) or near-black.
        if ((min >= 235 && max - min <= 20) || max <= 20) continue;
      }
      // 5 bits a channel: 32 768 bins at most.
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const bin = bins.get(key);
      if (bin) {
        bin.r += r;
        bin.g += g;
        bin.bl += b;
        bin.weight += 1;
      } else {
        bins.set(key, { l: 0, a: 0, b: 0, r, g, bl: b, weight: 1 });
      }
    }
  };
  add(ignoreExtremes);
  // A picture that is all background: keep it rather than return nothing.
  if (bins.size === 0 && ignoreExtremes) add(false);
  const points: Point[] = [];
  for (const bin of bins.values()) {
    const lab = rgbToOklab({
      r: bin.r / bin.weight,
      g: bin.g / bin.weight,
      b: bin.bl / bin.weight,
      a: 1,
    });
    points.push({ l: lab.l, a: lab.a, b: lab.b, weight: bin.weight });
  }
  return points;
}

/** Vibrant keeps the colourful pixels, muted the quiet ones; each falls back to all if too few. */
function byMethod(points: Point[], method: PaletteMethod): Point[] {
  if (method === 'dominant') return points;
  const total = points.reduce((n, p) => n + p.weight, 0);
  const kept = points.filter((p) =>
    method === 'vibrant' ? chroma(p) >= 0.1 && p.l > 0.35 : chroma(p) < 0.08 && p.l > 0.2,
  );
  const share = kept.reduce((n, p) => n + p.weight, 0) / total;
  return share >= 0.02 ? kept : points;
}

/** A small seeded generator, so the same image always gives the same palette. */
function random(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return x / 2_147_483_648;
  };
}

/** Weighted k-means with k-means++ seeding. */
function kmeans(points: Point[], k: number): { centre: Oklab; weight: number }[] {
  const rand = random(7);
  const centres: Oklab[] = [];
  // The heaviest bin first, then k-means++: far from every centre so far, by weight.
  const heaviest = points.reduce((best, p) => (p.weight > best.weight ? p : best));
  centres.push({ l: heaviest.l, a: heaviest.a, b: heaviest.b });
  const nearest = points.map((p) => distance2(p, heaviest));
  while (centres.length < Math.min(k, points.length)) {
    const total = points.reduce((n, p, i) => n + p.weight * (nearest[i] ?? 0), 0);
    if (total === 0) break;
    let pick = rand() * total;
    let chosen = points.length - 1;
    for (let i = 0; i < points.length; i += 1) {
      pick -= (points[i]?.weight ?? 0) * (nearest[i] ?? 0);
      if (pick <= 0) {
        chosen = i;
        break;
      }
    }
    const p = points[chosen];
    if (!p) break;
    centres.push({ l: p.l, a: p.a, b: p.b });
    points.forEach((q, i) => {
      nearest[i] = Math.min(nearest[i] ?? Infinity, distance2(q, p));
    });
  }
  const assignment = new Int32Array(points.length);
  const weights = new Float64Array(centres.length);
  for (let round = 0; round < 24; round += 1) {
    let moved = 0;
    for (const [i, p] of points.entries()) {
      let best = 0;
      let bestDistance = Infinity;
      for (const [j, c] of centres.entries()) {
        const d = distance2(p, c);
        if (d < bestDistance) {
          bestDistance = d;
          best = j;
        }
      }
      if (assignment[i] !== best) moved += 1;
      assignment[i] = best;
    }
    const sums = centres.map(() => ({ l: 0, a: 0, b: 0, w: 0 }));
    points.forEach((p, i) => {
      const s = sums[assignment[i] ?? 0];
      if (!s) return;
      s.l += p.l * p.weight;
      s.a += p.a * p.weight;
      s.b += p.b * p.weight;
      s.w += p.weight;
    });
    sums.forEach((s, j) => {
      weights[j] = s.w;
      if (s.w > 0) centres[j] = { l: s.l / s.w, a: s.a / s.w, b: s.b / s.w };
    });
    if (moved === 0 && round > 0) break;
  }
  return centres.map((centre, j) => ({ centre, weight: weights[j] ?? 0 }));
}

/**
 * The image's palette, most common first. May hold fewer colours than asked
 * when the image has fewer distinct ones.
 */
export function extractPalette(rgba: ArrayLike<number>, options: PaletteOptions): Swatch[] {
  const count = Math.min(12, Math.max(3, Math.round(options.count)));
  const points = byMethod(
    histogram(rgba, options.ignoreExtremes ?? true),
    options.method ?? 'dominant',
  );
  if (points.length === 0) return [];
  const clusters = kmeans(points, count).filter((c) => c.weight > 0);
  // Centres that ended up the same colour are one colour.
  const merged: { centre: Oklab; weight: number }[] = [];
  for (const c of clusters.sort((x, y) => y.weight - x.weight)) {
    const same = merged.find((m) => distance2(m.centre, c.centre) < SAME * SAME);
    if (same) {
      const w = same.weight + c.weight;
      same.centre = {
        l: (same.centre.l * same.weight + c.centre.l * c.weight) / w,
        a: (same.centre.a * same.weight + c.centre.a * c.weight) / w,
        b: (same.centre.b * same.weight + c.centre.b * c.weight) / w,
      };
      same.weight = w;
    } else {
      merged.push({ ...c });
    }
  }
  const total = merged.reduce((n, c) => n + c.weight, 0);
  return merged
    .sort((x, y) => y.weight - x.weight)
    .map((c) => {
      const rgb = toBytes(oklabToRgb(c.centre));
      return { rgb, hex: toHex(rgb), share: c.weight / total };
    });
}

const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

/** CSS custom properties, most common first. */
export function paletteCss(swatches: Swatch[]): string {
  const lines = swatches.map(
    (s, i) => `  --palette-${String(i + 1)}: ${s.hex}; /* ${percent(s.share)} */`,
  );
  return `:root {\n${lines.join('\n')}\n}\n`;
}

/** JSON with every notation and the share of the image. */
export function paletteJson(swatches: Swatch[]): string {
  return `${JSON.stringify(
    swatches.map((s) => {
      const f = formats(s.rgb);
      return { hex: s.hex, rgb: f.rgb, hsl: f.hsl, share: Number(s.share.toFixed(4)) };
    }),
    null,
    2,
  )}\n`;
}

/** Adobe Swatch Exchange (ASE 1.0): RGB global colours named by their HEX. */
export function paletteAse(swatches: Swatch[]): Uint8Array<ArrayBuffer> {
  const blocks = swatches.map((s) => {
    const name = `${s.hex.toUpperCase()}\0`;
    const length = 2 + name.length * 2 + 4 + 12 + 2;
    const block = new DataView(new ArrayBuffer(6 + length));
    block.setUint16(0, 0x0001); // colour entry
    block.setUint32(2, length);
    block.setUint16(6, name.length);
    for (let i = 0; i < name.length; i += 1) block.setUint16(8 + i * 2, name.charCodeAt(i));
    let at = 8 + name.length * 2;
    for (const c of 'RGB ') block.setUint8(at++, c.charCodeAt(0));
    for (const v of [s.rgb.r, s.rgb.g, s.rgb.b]) {
      block.setFloat32(at, v / 255);
      at += 4;
    }
    block.setUint16(at, 2); // normal (not global or spot)
    return new Uint8Array(block.buffer);
  });
  const out = new Uint8Array(12 + blocks.reduce((n, b) => n + b.length, 0));
  const head = new DataView(out.buffer);
  out.set([0x41, 0x53, 0x45, 0x46]); // ASEF
  head.setUint16(4, 1);
  head.setUint16(6, 0);
  head.setUint32(8, blocks.length);
  let at = 12;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}
