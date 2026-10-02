/**
 * P19 Image to SVG (tools/photo.md): our own tracer, pure and shared with
 * the Premiere panel.
 *
 * 1. Every pixel gets a colour: k-means in Oklab (C01's clustering), or
 *    black and white split at Otsu's threshold. Transparent pixels get none.
 * 2. Regions smaller than the detail setting join the neighbour they share
 *    the most border with, so anti-aliased edges and noise don't become shapes.
 * 3. The borders between regions are traced once, as chains between the
 *    points where three regions meet, so two neighbours always share the
 *    same line. Each chain's pixel steps become straight lines and smooth
 *    curves, its corners kept sharp.
 * 4. Colours are stacked, the most common at the bottom, each layer also
 *    covering the area of the layers above it: shapes never show a hairline
 *    gap between them, and every pixel still ends up its own colour.
 */
import { oklabToRgb, rgbToOklab, toBytes, toHex, type Oklab } from '../color/color';
import { quantize } from '../color/palette';

export type TraceMode = 'color' | 'bw';

export interface TraceOptions {
  mode: TraceMode;
  /** 2-16, colour mode. */
  colors: number;
  /** Regions smaller than this many pixels join a neighbour. */
  minArea: number;
  /** How far, in px, a line may stray from the pixel edges it replaces. */
  tolerance: number;
  /** Turns sharper than this many degrees stay corners; gentler ones become curves. */
  cornerAngle: number;
  /** The pixel edges as they are, for tests and pixel art: no lines straightened, no curves. */
  exact?: boolean;
}

export interface TracedLayer {
  hex: string;
  /** The SVG path data. */
  d: string;
  /** Pixels of this colour. */
  pixels: number;
}

export interface Traced {
  width: number;
  height: number;
  /** Bottom first. */
  layers: TracedLayer[];
}

/** No colour: transparent, or outside the image. */
const NONE = -1;

/** Labels per pixel and the colour of each label. */
export interface Labelled {
  labels: Int32Array;
  hexes: string[];
  /** Each label's colour in Oklab, to merge small regions into the nearest. */
  colours: Oklab[];
}

/** Otsu's threshold on 0-255 values: the split that best separates the two groups. */
export function otsu(histogram: ArrayLike<number>): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) {
    total += histogram[i] ?? 0;
    sum += i * (histogram[i] ?? 0);
  }
  let below = 0;
  let belowSum = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    below += histogram[t] ?? 0;
    if (below === 0) continue;
    const above = total - below;
    if (above === 0) break;
    belowSum += t * (histogram[t] ?? 0);
    const between = below * above * (belowSum / below - (sum - belowSum) / above) ** 2;
    if (between > best) {
      best = between;
      threshold = t + 1;
    }
  }
  return threshold;
}

/** Each pixel's colour label, `NONE` where it's transparent. */
export function labelPixels(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  mode: TraceMode,
  colors: number,
): Labelled {
  const count = width * height;
  const labels = new Int32Array(count).fill(NONE);
  if (mode === 'bw') {
    const luma = new Uint8Array(count);
    const histogram = new Float64Array(256);
    for (let p = 0; p < count; p += 1) {
      if ((rgba[p * 4 + 3] ?? 0) < 128) continue;
      const y = Math.round(
        0.2126 * (rgba[p * 4] ?? 0) +
          0.7152 * (rgba[p * 4 + 1] ?? 0) +
          0.0722 * (rgba[p * 4 + 2] ?? 0),
      );
      luma[p] = y;
      histogram[y] = (histogram[y] ?? 0) + 1;
    }
    const threshold = otsu(histogram);
    for (let p = 0; p < count; p += 1) {
      if ((rgba[p * 4 + 3] ?? 0) < 128) continue;
      labels[p] = (luma[p] ?? 0) < threshold ? 1 : 0;
    }
    return {
      labels,
      hexes: ['#ffffff', '#000000'],
      colours: [
        { l: 1, a: 0, b: 0 },
        { l: 0, a: 0, b: 0 },
      ],
    };
  }
  const centres = quantize(rgba, colors);
  // Nearest centre for each 15-bit colour bin, worked out once per bin.
  const nearest = new Int16Array(32_768).fill(-1);
  const closest = (lab: Oklab) => {
    let best = 0;
    let bestDistance = Infinity;
    centres.forEach((c, j) => {
      const d = (c.l - lab.l) ** 2 + (c.a - lab.a) ** 2 + (c.b - lab.b) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = j;
      }
    });
    return best;
  };
  for (let p = 0; p < count; p += 1) {
    if ((rgba[p * 4 + 3] ?? 0) < 128) continue;
    const r = rgba[p * 4] ?? 0;
    const g = rgba[p * 4 + 1] ?? 0;
    const b = rgba[p * 4 + 2] ?? 0;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let label = nearest[key] ?? -1;
    if (label < 0) {
      label = closest(
        rgbToOklab({ r: (r & 0xf8) + 4, g: (g & 0xf8) + 4, b: (b & 0xf8) + 4, a: 1 }),
      );
      nearest[key] = label;
    }
    labels[p] = label;
  }
  return { labels, hexes: centres.map((c) => toHex(toBytes(oklabToRgb(c)))), colours: centres };
}

/** The four pixels beside p, -1 off the edge. */
const beside = (p: number, width: number, count: number) => {
  const x = p % width;
  return [
    x > 0 ? p - 1 : -1,
    x < width - 1 ? p + 1 : -1,
    p >= width ? p - width : -1,
    p + width < count ? p + width : -1,
  ];
};

/**
 * Regions of one label, 4-connected: `component` gets each pixel's region,
 * `order` the pixels region by region, and the result where each region
 * starts in it (and, last, the pixel count).
 */
function findRegions(
  labels: Int32Array,
  width: number,
  component: Int32Array,
  order: Int32Array,
): number[] {
  const count = labels.length;
  component.fill(-1);
  const starts: number[] = [];
  let filled = 0;
  for (let seed = 0; seed < count; seed += 1) {
    if ((component[seed] ?? 0) >= 0) continue;
    const id = starts.length;
    starts.push(filled);
    const label = labels[seed];
    component[seed] = id;
    order[filled] = seed;
    let head = filled;
    filled += 1;
    while (head < filled) {
      const p = order[head] ?? 0;
      head += 1;
      for (const n of beside(p, width, count)) {
        if (n < 0 || (component[n] ?? 0) >= 0 || labels[n] !== label) continue;
        component[n] = id;
        order[filled] = n;
        filled += 1;
      }
    }
  }
  starts.push(count);
  return starts;
}

/**
 * Anti-aliased edges, made hard before the colours are picked: a pixel whose
 * colour lies between two very different colours on opposite sides of it
 * (left and right, above and below, or across a diagonal) is a blend of the
 * two, such as the soft rim around a shape, and takes the nearer one. The
 * edge then lands where the original's was, and the rim doesn't become a
 * ring of its own. A thin line keeps its colour: nothing is on both sides of it.
 */
export function sharpenEdges(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = Uint8ClampedArray.from(rgba);
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && (rgba[(y * width + x) * 4 + 3] ?? 0) >= 128;
  const PAIRS = [
    [-1, 0, 1, 0],
    [0, -1, 0, 1],
    [-1, -1, 1, 1],
    [1, -1, -1, 1],
  ] as const;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      if ((rgba[p + 3] ?? 0) < 128) continue;
      let a = -1;
      let b = -1;
      let widest = 48 * 48;
      for (const [ax, ay, bx, by] of PAIRS) {
        if (!opaque(x + ax, y + ay) || !opaque(x + bx, y + by)) continue;
        const i = ((y + ay) * width + x + ax) * 4;
        const j = ((y + by) * width + x + bx) * 4;
        const d =
          ((rgba[i] ?? 0) - (rgba[j] ?? 0)) ** 2 +
          ((rgba[i + 1] ?? 0) - (rgba[j + 1] ?? 0)) ** 2 +
          ((rgba[i + 2] ?? 0) - (rgba[j + 2] ?? 0)) ** 2;
        if (d > widest) {
          widest = d;
          a = i;
          b = j;
        }
      }
      if (a < 0) continue;
      // Where the pixel sits on the line from a to b (0 at a, 1 at b), and how far off it.
      let t = 0;
      for (let c = 0; c < 3; c += 1) {
        t += ((rgba[p + c] ?? 0) - (rgba[a + c] ?? 0)) * ((rgba[b + c] ?? 0) - (rgba[a + c] ?? 0));
      }
      t /= widest;
      if (t <= 0.05 || t >= 0.95) continue;
      let off = 0;
      for (let c = 0; c < 3; c += 1) {
        const on = (rgba[a + c] ?? 0) + t * ((rgba[b + c] ?? 0) - (rgba[a + c] ?? 0));
        off += ((rgba[p + c] ?? 0) - on) ** 2;
      }
      if (off > Math.max(16 * 16, widest * 0.04)) continue;
      const from = t < 0.5 ? a : b;
      out[p] = rgba[from] ?? 0;
      out[p + 1] = rgba[from + 1] ?? 0;
      out[p + 2] = rgba[from + 2] ?? 0;
    }
  }
  return out;
}

/**
 * Regions (4-connected, transparent ones too) smaller than `minArea` join a
 * neighbour: the one nearest in colour, so a sliver of a second blue joins
 * the blue beside it, not the background; then the one sharing the most
 * border. Transparent neighbours only take regions with nothing else beside
 * them. In place.
 */
export function removeSpeckles(
  labels: Int32Array,
  width: number,
  height: number,
  minArea: number,
  colours: Oklab[] = [],
): void {
  const apart = (a: number, b: number) => {
    if (a < 0 || b < 0) return a === b ? 0 : Infinity;
    const x = colours[a];
    const y = colours[b];
    return x && y ? (x.l - y.l) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2 : 0;
  };
  if (minArea <= 1) return;
  const count = width * height;
  const component = new Int32Array(count);
  const order = new Int32Array(count);
  for (let pass = 0; pass < 16; pass += 1) {
    const starts = findRegions(labels, width, component, order);
    const small: number[] = [];
    for (let id = 0; id < starts.length - 1; id += 1) {
      if ((starts[id + 1] ?? 0) - (starts[id] ?? 0) < minArea) small.push(id);
    }
    if (small.length === 0 || starts.length <= 2) return;
    small.sort(
      (a, b) => (starts[a + 1] ?? 0) - (starts[a] ?? 0) - ((starts[b + 1] ?? 0) - (starts[b] ?? 0)),
    );
    let changed = false;
    for (const id of small) {
      const from = starts[id] ?? 0;
      const to = starts[id + 1] ?? 0;
      const own = labels[order[from] ?? 0] ?? NONE;
      const shared = new Map<number, number>();
      // A neighbour that has since joined this region's colour: its size is out
      // of date, so it waits for the next pass, which finds the regions again.
      let grown = false;
      for (let i = from; i < to; i += 1) {
        for (const n of beside(order[i] ?? 0, width, count)) {
          if (n < 0) continue;
          const label = labels[n] ?? NONE;
          if (label !== own) shared.set(label, (shared.get(label) ?? 0) + 1);
          else if (component[n] !== id) grown = true;
        }
      }
      if (grown) {
        changed = true;
        continue;
      }
      let best = own;
      let most = 0;
      let nearest = Infinity;
      for (const [label, n] of shared) {
        const d = apart(own, label);
        const closer = d < nearest || (d === nearest && (n > most || (n === most && label < best)));
        if (best === own || closer) {
          best = label;
          most = n;
          nearest = d;
        }
      }
      if (best === own) continue;
      for (let i = from; i < to; i += 1) labels[order[i] ?? 0] = best;
      changed = true;
    }
    if (!changed) return;
  }
}

type Point = readonly [number, number];

/** A piece of outline: a line, or a cubic curve with its two handles. */
type Segment = { to: Point; c?: readonly [Point, Point] };

interface Chain {
  /** Lattice vertex indices at each end. */
  start: number;
  end: number;
  left: number;
  right: number;
  /** From the start point on (the start point itself not included). */
  segments: Segment[];
  from: Point;
}

/** Perpendicular distance from p to the line through a and b. */
function offLine(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length;
}

/** Ramer-Douglas-Peucker, both ends kept. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() ?? [0, 0];
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const d = offLine(points[i] ?? [0, 0], points[a] ?? [0, 0], points[b] ?? [0, 0]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * The points a chain's pixel steps stand for: its ends, the middle of each
 * straight run, and the corners between runs of 2 px or more. A staircase
 * becomes the line through it; a square corner stays square.
 */
function keyPoints(path: Point[], closed: boolean): Point[] {
  const runs: { from: Point; to: Point; length: number }[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] ?? [0, 0];
    const b = path[i] ?? [0, 0];
    const last = runs.at(-1);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (last && last.to === a) {
      const ldx = Math.sign(last.to[0] - last.from[0]);
      const ldy = Math.sign(last.to[1] - last.from[1]);
      if (ldx === dx && ldy === dy) {
        last.to = b;
        last.length += 1;
        continue;
      }
    }
    runs.push({ from: a, to: b, length: 1 });
  }
  const out: Point[] = [path[0] ?? [0, 0]];
  runs.forEach((run, i) => {
    if (i > 0 && run.length >= 2 && (runs[i - 1]?.length ?? 0) >= 2) out.push(run.from);
    out.push([(run.from[0] + run.to[0]) / 2, (run.from[1] + run.to[1]) / 2]);
  });
  out.push(path.at(-1) ?? [0, 0]);
  if (!closed) return out;
  // A loop starts at a corner: kept between two long runs, otherwise the loop starts mid-run.
  if ((runs[0]?.length ?? 0) >= 2 && (runs.at(-1)?.length ?? 0) >= 2) return out;
  const inner = out.slice(1, -1);
  return [...inner, inner[0] ?? [0, 0]];
}

/** Only the points where the direction changes. */
function corners(path: Point[]): Point[] {
  return path.filter((p, i) => {
    const a = path[i - 1];
    const b = path[i + 1];
    if (!a || !b) return true;
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
}

/** Lines and curves through the points; `closed` when it's a loop with no ends. */
function fit(points: Point[], cornerAngle: number, closed: boolean): Segment[] {
  const n = points.length;
  const at = (i: number): Point =>
    closed ? (points[((i % (n - 1)) + (n - 1)) % (n - 1)] ?? [0, 0]) : (points[i] ?? [0, 0]);
  const limit = Math.cos((cornerAngle * Math.PI) / 180);
  /** A unit tangent at point i, or null where it's a corner (or an end). */
  const tangent = (i: number): Point | null => {
    if (cornerAngle <= 0 || (!closed && (i === 0 || i === n - 1))) return null;
    const p = at(i);
    const a = at(i - 1);
    const b = at(i + 1);
    const ux = p[0] - a[0];
    const uy = p[1] - a[1];
    const vx = b[0] - p[0];
    const vy = b[1] - p[1];
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (lu === 0 || lv === 0) return null;
    // The turn: straight on is 1, a right angle 0.
    if ((ux * vx + uy * vy) / (lu * lv) < limit) return null;
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const lt = Math.hypot(tx, ty);
    return lt === 0 ? null : [tx / lt, ty / lt];
  };
  const tangents = points.map((_, i) => tangent(i));
  if (closed) tangents[n - 1] = tangents[0] ?? null;
  const segments: Segment[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const p = at(i);
    const q = points[i + 1] ?? [0, 0];
    const t0 = tangents[i] ?? null;
    const t1 = tangents[i + 1] ?? null;
    if (!t0 && !t1) {
      segments.push({ to: q });
      continue;
    }
    const third = Math.hypot(q[0] - p[0], q[1] - p[1]) / 3;
    const c1: Point = t0
      ? [p[0] + t0[0] * third, p[1] + t0[1] * third]
      : [p[0] + (q[0] - p[0]) / 3, p[1] + (q[1] - p[1]) / 3];
    const c2: Point = t1
      ? [q[0] - t1[0] * third, q[1] - t1[1] * third]
      : [q[0] - (q[0] - p[0]) / 3, q[1] - (q[1] - p[1]) / 3];
    segments.push({ to: q, c: [c1, c2] });
  }
  return segments;
}

/** The borders between differently labelled pixels, as chains between junctions. */
function traceChains(
  labels: Int32Array,
  width: number,
  height: number,
  options: TraceOptions,
): Chain[] {
  const W = width + 1;
  const label = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? NONE : (labels[y * width + x] ?? NONE);
  // Horizontal edge (x, y)→(x+1, y) and vertical edge (x, y)→(x, y+1), by their start vertex.
  const hEdge = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y <= height && label(x, y - 1) !== label(x, y);
  const vEdge = (x: number, y: number) =>
    y >= 0 && y < height && x >= 0 && x <= width && label(x - 1, y) !== label(x, y);
  const hUsed = new Uint8Array(W * (height + 1));
  const vUsed = new Uint8Array(W * (height + 1));
  const degree = (x: number, y: number) =>
    Number(hEdge(x, y)) + Number(hEdge(x - 1, y)) + Number(vEdge(x, y)) + Number(vEdge(x, y - 1));

  /** Unused edges leaving a vertex: [dx, dy]. */
  const exits = (x: number, y: number): Point[] => {
    const out: Point[] = [];
    if (hEdge(x, y) && !hUsed[y * W + x]) out.push([1, 0]);
    if (hEdge(x - 1, y) && !hUsed[y * W + x - 1]) out.push([-1, 0]);
    if (vEdge(x, y) && !vUsed[y * W + x]) out.push([0, 1]);
    if (vEdge(x, y - 1) && !vUsed[(y - 1) * W + x]) out.push([0, -1]);
    return out;
  };
  const use = (x: number, y: number, [dx, dy]: Point) => {
    if (dx === 1) hUsed[y * W + x] = 1;
    else if (dx === -1) hUsed[y * W + x - 1] = 1;
    else if (dy === 1) vUsed[y * W + x] = 1;
    else vUsed[(y - 1) * W + x] = 1;
  };
  /** The pixels left and right of a step, looking along it (y down). */
  const sides = (x: number, y: number, [dx, dy]: Point): [number, number] => {
    if (dx === 1) return [label(x, y - 1), label(x, y)];
    if (dx === -1) return [label(x - 1, y), label(x - 1, y - 1)];
    if (dy === 1) return [label(x, y), label(x - 1, y)];
    return [label(x - 1, y - 1), label(x, y - 1)];
  };

  const chains: Chain[] = [];
  const walk = (
    x0: number,
    y0: number,
    first: Point,
    isNode: (x: number, y: number) => boolean,
    closed: boolean,
  ) => {
    const [left, right] = sides(x0, y0, first);
    const path: Point[] = [[x0, y0]];
    let x = x0;
    let y = y0;
    let step: Point | undefined = first;
    while (step) {
      use(x, y, step);
      x += step[0];
      y += step[1];
      path.push([x, y]);
      if (isNode(x, y)) break;
      // Two edges here, one just used: the other one, keeping the same two sides.
      step = exits(x, y).find((s) => {
        const [l, r] = sides(x, y, s);
        return l === left && r === right;
      });
    }
    const points = options.exact ? corners(path) : keyPoints(path, closed);
    let segments: Segment[];
    if (options.exact) {
      segments = points.slice(1).map((to) => ({ to }));
    } else if (closed) {
      // A loop: fixed at its start and the point farthest from it, simplified in two halves.
      const start = points[0] ?? [0, 0];
      let far = 1;
      points.forEach((p, i) => {
        const best = points[far] ?? [0, 0];
        if (
          Math.hypot(p[0] - start[0], p[1] - start[1]) >
          Math.hypot(best[0] - start[0], best[1] - start[1])
        )
          far = i;
      });
      const simple = [
        ...simplify(points.slice(0, far + 1), options.tolerance),
        ...simplify(points.slice(far), options.tolerance).slice(1),
      ];
      segments = fit(simple, options.cornerAngle, true);
    } else {
      segments = fit(simplify(points, options.tolerance), options.cornerAngle, false);
    }
    chains.push({
      start: y0 * W + x0,
      end: y * W + x,
      left,
      right,
      from: points[0] ?? [x0, y0],
      segments,
    });
  };

  const node = (x: number, y: number) => degree(x, y) !== 2;
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      if (!node(x, y)) continue;
      for (let s = exits(x, y)[0]; s; s = exits(x, y)[0]) walk(x, y, s, node, false);
    }
  }
  // What's left are loops with no junction on them: each starts and ends where it was found.
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      const s = exits(x, y)[0];
      if (s) walk(x, y, s, (px, py) => px === x && py === y, true);
    }
  }
  return chains;
}

const num = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};
const pt = (p: Point) => `${num(p[0])} ${num(p[1])}`;

/** A chain, or a chain walked backwards, as one layer's outline uses it. */
interface Piece {
  from: Point;
  segments: Segment[];
  start: number;
  end: number;
}

/** A chain walked backwards: the same lines and curves, handles swapped. */
function reversed(chain: Chain): { from: Point; segments: Segment[] } {
  const points = [chain.from, ...chain.segments.map((s) => s.to)];
  const segments: Segment[] = [];
  for (let i = chain.segments.length - 1; i >= 0; i -= 1) {
    const s = chain.segments[i];
    const to = points[i] ?? [0, 0];
    segments.push(s?.c ? { to, c: [s.c[1], s.c[0]] } : { to });
  }
  return { from: points.at(-1) ?? chain.from, segments };
}

/** Pixels per label, and each label's place in the stack (most pixels at the bottom). */
function stackOrder(labels: Int32Array, colours: number, mode: TraceMode) {
  const pixels = new Array<number>(colours).fill(0);
  for (const label of labels) if (label >= 0) pixels[label] = (pixels[label] ?? 0) + 1;
  // Black and white: black always on top, so white can be left out.
  const order = [...pixels.keys()]
    .filter((label) => (pixels[label] ?? 0) > 0)
    .sort((a, b) => (mode === 'bw' ? a - b : (pixels[b] ?? 0) - (pixels[a] ?? 0) || a - b));
  const rank = new Int32Array(colours).fill(-1);
  order.forEach((label, i) => (rank[label] = i));
  return { pixels, order, rank };
}

/** Traces an RGBA image into stacked colour layers. */
export function vectorize(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: TraceOptions,
): Traced {
  const source =
    options.mode === 'color' && !options.exact ? sharpenEdges(rgba, width, height) : rgba;
  const { labels, hexes, colours } = labelPixels(
    source,
    width,
    height,
    options.mode,
    options.colors,
  );
  removeSpeckles(labels, width, height, Math.round(options.minArea), colours);
  const chains = traceChains(labels, width, height, options);
  const { pixels, order, rank } = stackOrder(labels, hexes.length, options.mode);
  const inStack = (label: number, level: number) => label >= 0 && (rank[label] ?? -1) >= level;
  const layers: TracedLayer[] = [];
  order.forEach((label, level) => {
    if (options.mode === 'bw' && label === 0) return;
    // This layer's area: its own pixels and those of every layer above it.
    const starts = new Map<number, Piece[]>();
    for (const chain of chains) {
      const leftIn = inStack(chain.left, level);
      if (leftIn === inStack(chain.right, level)) continue;
      // Walked with the area on the left.
      const piece = leftIn
        ? { from: chain.from, segments: chain.segments, start: chain.start, end: chain.end }
        : { ...reversed(chain), start: chain.end, end: chain.start };
      const list = starts.get(piece.start) ?? [];
      list.push(piece);
      starts.set(piece.start, list);
    }
    const parts: string[] = [];
    for (const [start, list] of starts) {
      while (list.length > 0) {
        let piece: Piece | undefined = list.pop();
        if (!piece) break;
        let d = `M${pt(piece.from)}`;
        for (;;) {
          for (const s of piece.segments) {
            d += s.c ? `C${pt(s.c[0])} ${pt(s.c[1])} ${pt(s.to)}` : `L${pt(s.to)}`;
          }
          if (piece.end === start) break;
          const next: Piece | undefined = starts.get(piece.end)?.pop();
          if (!next) break;
          piece = next;
        }
        parts.push(`${d}Z`);
      }
    }
    if (parts.length > 0) {
      layers.push({
        hex: hexes[label] ?? '#000000',
        d: parts.join(''),
        pixels: pixels[label] ?? 0,
      });
    }
  });
  return { width, height, layers };
}

/** The SVG file: the traced layers, drawn at `outWidth` × `outHeight`. Nothing but paths. */
export function toSvg(traced: Traced, outWidth = traced.width, outHeight = traced.height): string {
  const paths = traced.layers.map((layer) => `<path fill="${layer.hex}" d="${layer.d}"/>`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(outWidth)}" height="${String(outHeight)}" viewBox="0 0 ${String(traced.width)} ${String(traced.height)}">`,
    ...paths,
    '</svg>',
    '',
  ].join('\n');
}
