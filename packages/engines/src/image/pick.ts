/**
 * C02 Color Picker from Image: reading a colour where the user points
 * (one pixel, or a 3 × 3 or 5 × 5 average taken in linear light, per the
 * colour tools' shared rules), and the picked colours as a file to keep.
 */
import { color, paletteAse, type Swatch } from '@etb/core';

import type { Engine, EngineOutput } from '../types';

export interface PickedColor {
  hex: string;
  rgb: string;
  hsl: string;
}

/** Every notation of an 8-bit colour, for the readout and the copy buttons. */
export function describeColor(r: number, g: number, b: number): PickedColor {
  const f = color.formats({ r, g, b, a: 1 });
  return { hex: f.hex, rgb: f.rgb, hsl: f.hsl };
}

/**
 * The colour of a size × size block of RGBA pixels (1, 3 or 5), averaged in
 * linear light; transparent pixels count for nothing.
 */
export function sampleColor(rgba: ArrayLike<number>): PickedColor {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = (rgba[i + 3] ?? 0) / 255;
    if (a === 0) continue;
    r += color.toLinear(rgba[i] ?? 0) * a;
    g += color.toLinear(rgba[i + 1] ?? 0) * a;
    b += color.toLinear(rgba[i + 2] ?? 0) * a;
    weight += a;
  }
  if (weight === 0) return describeColor(0, 0, 0);
  return describeColor(
    Math.round(color.fromLinear(r / weight)),
    Math.round(color.fromLinear(g / weight)),
    Math.round(color.fromLinear(b / weight)),
  );
}

export interface PickedColorsOptions {
  /** JSON array of HEX strings, newest first (the picker writes it). */
  picked?: string;
  /** css, json or ase */
  export?: string;
}

/** The picks as a list of HEX colours; anything that isn't one is left out. */
export function readPicked(json: string | undefined): string[] {
  try {
    const list: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(list)
      ? list.filter((v): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))
      : [];
  } catch {
    return [];
  }
}

/** Writes the picked colours, oldest first, as CSS variables, JSON or ASE. */
export const pickedColorsEngine: Engine<PickedColorsOptions> = {
  capabilities: () => ({ supported: true }),
  estimate: () => ({ seconds: 0 }),
  // The image is the picker's; the file is the list of colours picked from it.
  run(_file, opts): Promise<EngineOutput> {
    const hexes = readPicked(opts.picked).reverse();
    const described = hexes.map((hex) => {
      const parsed = color.parseColor(hex);
      const rgb = parsed.ok ? parsed.rgb : { r: 0, g: 0, b: 0, a: 1 };
      return { bytes: rgb, ...describeColor(rgb.r, rgb.g, rgb.b) };
    });
    const kind = opts.export === 'json' || opts.export === 'ase' ? opts.export : 'css';
    let blob: Blob;
    if (kind === 'ase') {
      const swatches: Swatch[] = described.map((d) => ({ rgb: d.bytes, hex: d.hex, share: 0 }));
      blob = new Blob([paletteAse(swatches)], { type: 'application/octet-stream' });
    } else if (kind === 'json') {
      blob = new Blob(
        [
          `${JSON.stringify(
            described.map((d) => ({ hex: d.hex, rgb: d.rgb, hsl: d.hsl })),
            null,
            2,
          )}\n`,
        ],
        { type: 'application/json' },
      );
    } else {
      const lines = described.map((d, i) => `  --picked-${String(i + 1)}: ${d.hex};`);
      blob = new Blob(
        [
          described.length
            ? `:root {\n${lines.join('\n')}\n}\n`
            : '/* No colors picked yet: click the image to pick one. */\n',
        ],
        { type: 'text/css' },
      );
    }
    return Promise.resolve({
      blob,
      ext: kind,
      path: 'Browser',
      notes: [
        described.length === 0
          ? 'No colors picked yet'
          : `${String(described.length)} color${described.length === 1 ? '' : 's'} picked`,
      ],
    });
  },
};
