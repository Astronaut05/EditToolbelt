/**
 * QR code matrix and drawing for U01 (tools/utility.md). The `qrcode` package
 * only builds the module matrix; the SVG is ours (clean, no scripts) and the
 * same path strings draw the PNG through `Path2D`, so both outputs match.
 */
import { create } from 'qrcode';

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrix {
  /** Modules per side, without the quiet zone. */
  size: number;
  version: number;
  ec: EcLevel;
  /** Row-major, true = dark. */
  dark: boolean[];
}

export type MatrixResult = { ok: true; matrix: QrMatrix } | { ok: false; error: string };

export function qrMatrix(text: string, ec: EcLevel): MatrixResult {
  try {
    const code = create(text, { errorCorrectionLevel: ec });
    const { size, data } = code.modules;
    return {
      ok: true,
      matrix: { size, version: code.version, ec, dark: Array.from(data, (bit) => bit === 1) },
    };
  } catch {
    return {
      ok: false,
      error: `Too much for one QR code at level ${ec}. Shorten it, or pick a lower error correction level.`,
    };
  }
}

export interface QrStyle {
  /** Quiet zone in modules; the spec asks for 4. */
  margin: number;
  dots: 'square' | 'rounded';
  eyes: 'square' | 'rounded';
  /** Share of the code's width kept clear for a centre logo (0 = no logo). */
  logo: number;
}

export interface QrPaths {
  /** Width and height in modules, quiet zone included. */
  extent: number;
  /** Data modules. */
  dots: string;
  /** The three finder patterns ("eyes"): outer rings and centres. Fill with the even-odd rule. */
  eyes: string;
  /** The logo box in modules, or null. */
  logo: { x: number; y: number; size: number } | null;
}

function isFinder(size: number, x: number, y: number): boolean {
  const near = (a: number) => a < 7;
  const far = (a: number) => a >= size - 7;
  return (near(x) && near(y)) || (far(x) && near(y)) || (near(x) && far(y));
}

/** A rectangle, with rounded corners when r > 0. Holes rely on the even-odd fill rule. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${x} ${y}h${w}v${h}h${-w}z`;
  const side = (length: number) => length - 2 * r;
  return `M${x + r} ${y}h${side(w)}a${r} ${r} 0 0 1 ${r} ${r}v${side(h)}a${r} ${r} 0 0 1 ${-r} ${r}h${-side(w)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-side(h)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}

/** Path data in module units for the dots, the eyes and the logo box. */
export function qrPaths(matrix: QrMatrix, style: QrStyle): QrPaths {
  const { size, dark } = matrix;
  const m = style.margin;
  const extent = size + 2 * m;

  let logo: QrPaths['logo'] = null;
  if (style.logo > 0) {
    // Whole modules, centred, with the same parity as the code so it sits evenly.
    let box = Math.round(size * style.logo);
    if (box % 2 !== size % 2) box += 1;
    const start = (size - box) / 2;
    logo = { x: start + m, y: start + m, size: box };
  }
  const underLogo = (x: number, y: number) =>
    logo !== null &&
    x >= logo.x - m &&
    x < logo.x - m + logo.size &&
    y >= logo.y - m &&
    y < logo.y - m + logo.size;

  let dots = '';
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      const on = (col: number) =>
        dark[y * size + col] === true && !isFinder(size, col, y) && !underLogo(col, y);
      if (!on(x)) {
        x += 1;
        continue;
      }
      if (style.dots === 'rounded') {
        dots += `M${x + m} ${y + m + 0.5}a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0`;
        x += 1;
        continue;
      }
      // Square dots: one rectangle per horizontal run keeps the path short.
      let run = 1;
      while (x + run < size && on(x + run)) run += 1;
      dots += `M${x + m} ${y + m}h${run}v1h${-run}z`;
      x += run;
    }
  }

  const round = style.eyes === 'rounded';
  let eyes = '';
  for (const [cx, cy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ] as const) {
    const x = cx + m;
    const y = cy + m;
    eyes += roundedRect(x, y, 7, 7, round ? 2 : 0);
    eyes += roundedRect(x + 1, y + 1, 5, 5, round ? 1.5 : 0);
    eyes += roundedRect(x + 2, y + 2, 3, 3, round ? 1 : 0);
  }
  return { extent, dots, eyes, logo };
}

export interface SvgOptions {
  /** Output width and height in px. */
  px: number;
  fg: string;
  bg: string;
  /** A raster data: URL (we rasterise logos first, so the SVG never embeds foreign markup). */
  logoHref?: string;
}

const COLOR = /^#[0-9a-f]{6}$/i;

/** A standalone SVG file: no scripts, no external references. */
export function qrSvg(paths: QrPaths, options: SvgOptions): string {
  if (!COLOR.test(options.fg) || !COLOR.test(options.bg)) throw new Error('colors must be #rrggbb');
  if (
    options.logoHref &&
    !/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(options.logoHref)
  ) {
    throw new Error('the logo must be a raster data: URL');
  }
  const { extent, dots, eyes, logo } = paths;
  const image =
    logo && options.logoHref
      ? `<image href="${options.logoHref}" x="${String(logo.x + 0.5)}" y="${String(logo.y + 0.5)}" width="${String(logo.size - 1)}" height="${String(logo.size - 1)}" preserveAspectRatio="xMidYMid meet"/>`
      : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(options.px)}" height="${String(options.px)}" viewBox="0 0 ${String(extent)} ${String(extent)}" shape-rendering="crispEdges">`,
    `<rect width="${String(extent)}" height="${String(extent)}" fill="${options.bg}"/>`,
    `<path fill="${options.fg}" fill-rule="evenodd" d="${eyes}"/>`,
    `<path fill="${options.fg}" d="${dots}"/>`,
    image,
    '</svg>',
  ].join('');
}

/** WCAG relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * A warning when a colour pair may not scan: too little contrast, or light
 * modules on a dark ground (many scanner apps can't read inverted codes).
 */
export function scanWarning(fg: string, bg: string): string | null {
  const a = luminance(fg);
  const b = luminance(bg);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (ratio < 4) {
    return `Contrast is ${ratio.toFixed(1)}:1. Below 4:1, some phones won't scan it: use darker dots or a lighter background.`;
  }
  if (a > b) return 'Light dots on a dark background: some scanner apps can’t read inverted codes.';
  return null;
}
