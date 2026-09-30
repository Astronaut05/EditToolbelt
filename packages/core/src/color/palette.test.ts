import { describe, expect, it } from 'vitest';

import { deltaE, type Rgb } from './color';
import { extractPalette, paletteAse, paletteCss, paletteJson } from './palette';

/** An image of flat blocks: each colour covers `share` of 10 000 pixels. */
function blocks(colours: [number, number, number, number][]): Uint8Array {
  const out: number[] = [];
  for (const [r, g, b, pixels] of colours) {
    for (let i = 0; i < pixels; i += 1) out.push(r, g, b, 255);
  }
  return Uint8Array.from(out);
}

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b, a: 1 });

describe('palette from image', () => {
  const four: [number, number, number, number][] = [
    [220, 40, 50, 4000],
    [30, 120, 200, 3000],
    [250, 200, 40, 2000],
    [40, 160, 90, 1000],
  ];

  it('finds exactly the 4 flat colours, within ΔE 2, most common first', () => {
    const palette = extractPalette(blocks(four), { count: 6 });
    expect(palette).toHaveLength(4);
    palette.forEach((swatch, i) => {
      const [r, g, b, pixels] = four[i] ?? [0, 0, 0, 0];
      expect(deltaE(swatch.rgb, rgb(r, g, b))).toBeLessThanOrEqual(2);
      expect(swatch.share).toBeCloseTo(pixels / 10_000, 3);
    });
  });

  it('is the same every time', () => {
    const noisy = Uint8Array.from({ length: 40_000 }, (_, i) =>
      i % 4 === 3 ? 255 : (i * 7919) % 256,
    );
    expect(extractPalette(noisy, { count: 8 })).toEqual(extractPalette(noisy, { count: 8 }));
    expect(extractPalette(noisy, { count: 8 })).toHaveLength(8);
  });

  it('leaves out a white background and black shadows unless asked to keep them', () => {
    const image = blocks([[255, 255, 255, 6000], [5, 5, 5, 2000], ...four.slice(0, 2)]);
    const skipped = extractPalette(image, { count: 5 });
    expect(skipped.map((s) => s.hex)).toEqual(['#dc2832', '#1e78c8']);
    const kept = extractPalette(image, { count: 5, ignoreExtremes: false });
    expect(kept[0]?.hex).toBe('#ffffff');
    expect(kept).toHaveLength(4);
  });

  it('picks colourful clusters for vibrant and quiet ones for muted', () => {
    const image = blocks([
      [128, 128, 128, 5000],
      [150, 140, 130, 3000],
      [255, 0, 80, 1000],
      [0, 200, 255, 1000],
    ]);
    const vibrant = extractPalette(image, { count: 3, method: 'vibrant' });
    expect(vibrant.map((s) => s.hex).sort()).toEqual(['#00c8ff', '#ff0050']);
    const muted = extractPalette(image, { count: 3, method: 'muted' });
    expect(muted.map((s) => s.hex)).toEqual(['#808080', '#968c82']);
  });

  it('exports CSS variables, JSON and ASE', () => {
    const palette = extractPalette(blocks(four), { count: 4 });
    expect(paletteCss(palette)).toContain('--palette-1: #dc2832; /* 40.0% */');
    expect((JSON.parse(paletteJson(palette)) as unknown[])[1]).toMatchObject({
      hex: '#1e78c8',
      rgb: 'rgb(30, 120, 200)',
      share: 0.3,
    });
    const ase = paletteAse(palette);
    const view = new DataView(ase.buffer);
    expect(String.fromCharCode(...ase.subarray(0, 4))).toBe('ASEF');
    expect(view.getUint32(8)).toBe(4);
    // First block: colour entry, name "#DC2832" + NUL in UTF-16, then RGB floats.
    expect(view.getUint16(12)).toBe(1);
    expect(view.getUint16(18)).toBe(8);
    const model = 20 + 16;
    expect(String.fromCharCode(...ase.subarray(model, model + 4))).toBe('RGB ');
    expect(view.getFloat32(model + 4)).toBeCloseTo(220 / 255, 6);
    expect(ase.length).toBe(12 + 4 * (6 + 2 + 16 + 4 + 12 + 2));
  });
});
