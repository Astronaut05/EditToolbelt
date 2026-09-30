/**
 * Colour maths for C03 Color Converter and the other colour tools
 * (tools/color.md). sRGB in, every common notation out. Lab is CIE Lab with a
 * D50 white, the way CSS `lab()` and Photoshop read it; Oklab/Oklch follow
 * Björn Ottosson's definition, as CSS `oklch()` does. Matrices are from
 * CSS Color 4 → Sample code. Blending goes through linear light.
 */
import { CSS_NAMED_COLORS } from './names';

/** sRGB, channels 0-255 (fractions allowed), alpha 0-1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

function multiply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------- linear light

export function toLinear(channel255: number): number {
  const c = channel255 / 255;
  const magnitude = Math.abs(c);
  const linear = magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4;
  return Math.sign(c) * linear;
}

export function fromLinear(linear: number): number {
  const magnitude = Math.abs(linear);
  const c = magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * magnitude ** (1 / 2.4) - 0.055;
  return Math.sign(linear) * c * 255;
}

function linearRgb({ r, g, b }: Rgb): Vec3 {
  return [toLinear(r), toLinear(g), toLinear(b)];
}

function fromLinearRgb([r, g, b]: Vec3, a = 1): Rgb {
  return { r: fromLinear(r), g: fromLinear(g), b: fromLinear(b), a };
}

// ---------------------------------------------------------------- HSL, HSV, CMYK

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hueOf(r: number, g: number, b: number, max: number, delta: number): number {
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

/** h 0-360, s and l 0-100. */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h: hueOf(rr, gg, bb, max, delta), s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl, a = 1): Rgb {
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const chroma = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => 255 * (ll - chroma * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4), a };
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const delta = max - Math.min(rr, gg, bb);
  return { h: hueOf(rr, gg, bb, max, delta), s: max === 0 ? 0 : (delta / max) * 100, v: max * 100 };
}

export function hsvToRgb({ h, s, v }: Hsv, a = 1): Rgb {
  const ss = clamp(s, 0, 100) / 100;
  const vv = clamp(v, 0, 100) / 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (vv - vv * ss * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return { r: f(5), g: f(3), b: f(1), a };
}

export interface Cmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

/** Naive device CMYK, 0-100. Not colour-managed: print shops use ICC profiles. */
export function rgbToCmyk({ r, g, b }: Rgb): Cmyk {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const k = 1 - Math.max(rr, gg, bb);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: ((1 - rr - k) / (1 - k)) * 100,
    m: ((1 - gg - k) / (1 - k)) * 100,
    y: ((1 - bb - k) / (1 - k)) * 100,
    k: k * 100,
  };
}

export function cmykToRgb({ c, m, y, k }: Cmyk, a = 1): Rgb {
  const kk = 1 - clamp(k, 0, 100) / 100;
  return {
    r: 255 * (1 - clamp(c, 0, 100) / 100) * kk,
    g: 255 * (1 - clamp(m, 0, 100) / 100) * kk,
    b: 255 * (1 - clamp(y, 0, 100) / 100) * kk,
    a,
  };
}

// ---------------------------------------------------------------- CIE Lab (D50)

const LINEAR_SRGB_TO_XYZ_D65: Mat3 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_D65_TO_LINEAR_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const D65_TO_D50: Mat3 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
];
const D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function rgbToLab(rgb: Rgb): Lab {
  const xyz = multiply(D65_TO_D50, multiply(LINEAR_SRGB_TO_XYZ_D65, linearRgb(rgb)));
  const f = (value: number, white: number) => {
    const x = value / white;
    return x > EPSILON ? Math.cbrt(x) : (KAPPA * x + 16) / 116;
  };
  const fx = f(xyz[0], D50_WHITE[0]);
  const fy = f(xyz[1], D50_WHITE[1]);
  const fz = f(xyz[2], D50_WHITE[2]);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb({ l, a, b }: Lab, alpha = 1): Rgb {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const xyz: Vec3 = [
    (fx ** 3 > EPSILON ? fx ** 3 : (116 * fx - 16) / KAPPA) * D50_WHITE[0],
    (l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA) * D50_WHITE[1],
    (fz ** 3 > EPSILON ? fz ** 3 : (116 * fz - 16) / KAPPA) * D50_WHITE[2],
  ];
  return fromLinearRgb(multiply(XYZ_D65_TO_LINEAR_SRGB, multiply(D50_TO_D65, xyz)), alpha);
}

// ---------------------------------------------------------------- Oklab, Oklch

export interface Oklab {
  l: number;
  a: number;
  b: number;
}

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export function rgbToOklab(rgb: Rgb): Oklab {
  const [r, g, b] = linearRgb(rgb);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb({ l: L, a, b }: Oklab, alpha = 1): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return fromLinearRgb(
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ],
    alpha,
  );
}

/** l 0-1, c ≥ 0, h 0-360 (0 when there is no chroma). */
export function rgbToOklch(rgb: Rgb): Oklch {
  const { l, a, b } = rgbToOklab(rgb);
  const c = Math.hypot(a, b);
  const h = c < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

export function oklchToRgb({ l, c, h }: Oklch, alpha = 1): Rgb {
  const rad = (h * Math.PI) / 180;
  return oklabToRgb({ l, a: c * Math.cos(rad), b: c * Math.sin(rad) }, alpha);
}

// ---------------------------------------------------------------- gamut, hex

/** True if every channel is within 0-255 (half a unit of slack for rounding). */
export function inGamut({ r, g, b }: Rgb): boolean {
  return [r, g, b].every((channel) => channel >= -0.5 && channel <= 255.5);
}

/** Clipped to 0-255 and rounded to whole 8-bit values. */
export function toBytes(rgb: Rgb): Rgb {
  return {
    r: Math.round(clamp(rgb.r, 0, 255)),
    g: Math.round(clamp(rgb.g, 0, 255)),
    b: Math.round(clamp(rgb.b, 0, 255)),
    a: clamp(rgb.a, 0, 1),
  };
}

const hex2 = (value: number) => Math.round(value).toString(16).padStart(2, '0');

export function toHex(rgb: Rgb): string {
  const { r, g, b, a } = toBytes(rgb);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ''}`;
}

// ---------------------------------------------------------------- parsing

export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'hsv' | 'cmyk' | 'lab' | 'oklch' | 'name';

export type ParseResult =
  { ok: true; rgb: Rgb; format: ColorFormat; clipped: boolean } | { ok: false; error: string };

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** Splits "255, 99, 71", "255 99 71 / 50%" or "9deg 100% 64%" into numbers (%/deg kept as flags). */
function args(body: string): { values: { n: number; percent: boolean }[]; alpha?: number } | null {
  const [main = '', alphaPart] = body.split('/');
  const parts = main
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const values: { n: number; percent: boolean }[] = [];
  for (const part of parts) {
    const unit = /(%|deg)$/i.exec(part)?.[1]?.toLowerCase();
    const raw = unit ? part.slice(0, -unit.length) : part;
    if (!NUMBER.test(raw)) return null;
    values.push({ n: Number(raw), percent: unit === '%' });
  }
  let alpha: number | undefined;
  if (alphaPart !== undefined) {
    const text = alphaPart.trim();
    const percent = text.endsWith('%');
    const raw = percent ? text.slice(0, -1) : text;
    if (!NUMBER.test(raw)) return null;
    alpha = percent ? Number(raw) / 100 : Number(raw);
  }
  return { values, alpha };
}

function parseHex(text: string): Rgb | null {
  const hex = text.replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const full = hex.length <= 4 ? hex.replace(/./g, '$&$&') : hex;
  const byte = (index: number) => parseInt(full.slice(index, index + 2), 16);
  return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) / 255 : 1 };
}

const FUNCTION = /^(rgba?|hsla?|hsv|hsb|cmyk|lab|oklch)\s*\((.*)\)$/i;

/**
 * Reads a colour the way people paste it: #ff6347, ff6347, #f64, rgb(255, 99,
 * 71), rgba(…), rgb(255 99 71 / 50%), 255, 99, 71, hsl(9, 100%, 64%),
 * hsv(9, 72%, 100%), cmyk(0, 61, 72, 0), lab(62 54 49), oklch(70% 0.19 33),
 * or a CSS name like tomato.
 */
export function parseColor(input: string): ParseResult {
  const text = input.trim().toLowerCase().replace(/;$/, '');
  if (!text) return { ok: false, error: 'Type a color, like #ff6347, rgb(255, 99, 71) or tomato.' };

  const named = parseHex(CSS_NAMED_COLORS[text.replace(/\s+/g, '')] ?? '');
  if (named) return done(named, 'name');

  const hex = parseHex(text);
  if (hex && (text.startsWith('#') || /[a-f]/.test(text) || text.length === 6))
    return done(hex, 'hex');

  const match = FUNCTION.exec(text);
  const fn = match?.[1] ?? (/^[\d.\s,]+$/.test(text) ? 'rgb' : null);
  const parsed = args(match?.[2] ?? text);
  if (!fn || !parsed) {
    return {
      ok: false,
      error:
        'Not a color this tool reads. Try #ff6347, rgb(255, 99, 71), hsl(9, 100%, 64%) or tomato.',
    };
  }
  let { values, alpha = 1 } = parsed;
  // Legacy comma syntax carries alpha as a 4th value: rgba(255, 99, 71, 0.5).
  const last = values[3];
  if (fn !== 'cmyk' && values.length === 4 && last && parsed.alpha === undefined) {
    alpha = last.percent ? last.n / 100 : last.n;
    values = values.slice(0, 3);
  }
  const want = (count: number) => values.length === count;
  const a = clamp(alpha, 0, 1);
  const [first = { n: 0, percent: false }] = values;
  const [x = 0, y = 0, z = 0, w = 0] = values.map((value) => value.n);

  switch (fn) {
    case 'rgb':
    case 'rgba': {
      if (!want(3))
        return { ok: false, error: 'RGB needs three numbers: red, green and blue, 0-255.' };
      const [r = 0, g = 0, b = 0] = values.map((value) =>
        value.percent ? value.n * 2.55 : value.n,
      );
      if ([r, g, b].some((channel) => channel < 0 || channel > 255)) {
        return { ok: false, error: 'RGB values go from 0 to 255.' };
      }
      return done({ r, g, b, a }, 'rgb');
    }
    case 'hsl':
    case 'hsla':
      if (!want(3)) return { ok: false, error: 'HSL needs hue, saturation and lightness.' };
      return done(hslToRgb({ h: mod360(x), s: y, l: z }, a), 'hsl');
    case 'hsv':
    case 'hsb':
      if (!want(3)) return { ok: false, error: 'HSV needs hue, saturation and value.' };
      return done(hsvToRgb({ h: mod360(x), s: y, v: z }, a), 'hsv');
    case 'cmyk':
      if (!want(4))
        return {
          ok: false,
          error: 'CMYK needs four percentages: cyan, magenta, yellow and black.',
        };
      return done(cmykToRgb({ c: x, m: y, y: z, k: w }, a), 'cmyk');
    case 'lab':
      if (!want(3)) return { ok: false, error: 'Lab needs lightness, a and b.' };
      return done(labToRgb({ l: x, a: y, b: z }, a), 'lab');
    default: {
      if (!want(3)) return { ok: false, error: 'Oklch needs lightness, chroma and hue.' };
      // CSS oklch(): lightness as 0-1 or a percentage.
      const l = first.percent ? x / 100 : x;
      return done(oklchToRgb({ l, c: y, h: mod360(z) }, a), 'oklch');
    }
  }
}

function mod360(h: number): number {
  return ((h % 360) + 360) % 360;
}

function done(rgb: Rgb, format: ColorFormat): ParseResult {
  return { ok: true, rgb: toBytes(rgb), format, clipped: !inGamut(rgb) };
}

// ---------------------------------------------------------------- formatting

/** Up to `digits` decimals, trailing zeros dropped: 64 → "64", 63.92 → "63.9". */
export function round(value: number, digits = 1): string {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export interface Formats {
  hex: string;
  rgb: string;
  hsl: string;
  hsv: string;
  cmyk: string;
  lab: string;
  oklch: string;
}

/** Every notation for one 8-bit colour, ready to paste (CSS syntax where CSS has one). */
export function formats(input: Rgb): Formats {
  const rgb = toBytes(input);
  const alpha = rgb.a < 1 ? round(rgb.a, 3) : null;
  const hsl = rgbToHsl(rgb);
  const hsv = rgbToHsv(rgb);
  const cmyk = rgbToCmyk(rgb);
  const lab = rgbToLab(rgb);
  const oklch = rgbToOklch(rgb);
  const slash = alpha ? ` / ${alpha}` : '';
  return {
    hex: toHex(rgb),
    rgb: alpha
      ? `rgba(${String(rgb.r)}, ${String(rgb.g)}, ${String(rgb.b)}, ${alpha})`
      : `rgb(${String(rgb.r)}, ${String(rgb.g)}, ${String(rgb.b)})`,
    hsl: alpha
      ? `hsla(${round(hsl.h)}, ${round(hsl.s)}%, ${round(hsl.l)}%, ${alpha})`
      : `hsl(${round(hsl.h)}, ${round(hsl.s)}%, ${round(hsl.l)}%)`,
    hsv: `hsv(${round(hsv.h)}, ${round(hsv.s)}%, ${round(hsv.v)}%)`,
    cmyk: `cmyk(${round(cmyk.c, 0)}%, ${round(cmyk.m, 0)}%, ${round(cmyk.y, 0)}%, ${round(cmyk.k, 0)}%)`,
    lab: `lab(${round(lab.l, 2)} ${round(lab.a, 2)} ${round(lab.b, 2)}${slash})`,
    oklch: `oklch(${round(oklch.l * 100, 2)}% ${round(oklch.c, 4)} ${round(oklch.h, 2)}${slash})`,
  };
}

// ---------------------------------------------------------------- names, mixing

/** Distance in Oklab × 100 (about 1 = just noticeable). */
export function deltaE(x: Rgb, y: Rgb): number {
  const a = rgbToOklab(x);
  const b = rgbToOklab(y);
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b) * 100;
}

let namedCache: { name: string; rgb: Rgb }[] | null = null;

/** The closest CSS named colour; `distance` 0 means exact. Aliases (grey/gray, aqua/cyan) give the first name. */
export function nearestName(rgb: Rgb): { name: string; distance: number } {
  namedCache ??= Object.entries(CSS_NAMED_COLORS).flatMap(([name, hex]) => {
    const rgb = parseHex(hex);
    return rgb ? [{ name, rgb }] : [];
  });
  let best = { name: 'black', distance: Infinity };
  for (const candidate of namedCache) {
    const distance = deltaE(rgb, candidate.rgb);
    if (distance < best.distance) best = { name: candidate.name, distance };
  }
  return best;
}

/** Mixes in linear light: amount 0 = `from`, 1 = `to`. */
export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const x = linearRgb(from);
  const y = linearRgb(to);
  return toBytes(
    fromLinearRgb(
      [x[0] + (y[0] - x[0]) * amount, x[1] + (y[1] - x[1]) * amount, x[2] + (y[2] - x[2]) * amount],
      from.a + (to.a - from.a) * amount,
    ),
  );
}

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgb = { r: 0, g: 0, b: 0, a: 1 };

/** Tints (towards white) and shades (towards black) at 20, 40, 60 and 80 %, mixed in linear light. */
export function tintsAndShades(rgb: Rgb): { tints: Rgb[]; shades: Rgb[] } {
  const steps = [0.8, 0.6, 0.4, 0.2];
  return {
    tints: steps.map((step) => mix(rgb, { ...WHITE, a: rgb.a }, step)),
    shades: [...steps].reverse().map((step) => mix(rgb, { ...BLACK, a: rgb.a }, step)),
  };
}
