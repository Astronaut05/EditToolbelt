import { describe, expect, it } from 'vitest';

import { applyLut, identityLut, lookup, LutError, parseCube, type Lut } from './lut';

/** A `.cube` of a function, at a grid size. */
function cubeOf(size: number, f: (r: number, g: number, b: number) => [number, number, number]) {
  const rows = [`TITLE "test"`, `LUT_3D_SIZE ${String(size)}`];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        rows.push(
          f(r / (size - 1), g / (size - 1), b / (size - 1))
            .map((v) => v.toFixed(6))
            .join(' '),
        );
      }
    }
  }
  return rows.join('\n');
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Every 8-bit colour on a coarse grid, as RGBA. */
function swatch(): Uint8ClampedArray {
  const out: number[] = [];
  for (let r = 0; r < 256; r += 15)
    for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) out.push(r, g, b, 200);
  return Uint8ClampedArray.from(out);
}

describe('parseCube', () => {
  it('reads a 3D cube with its title and domain, comments and blank lines', () => {
    const lut = parseCube(
      `# made by hand\nTITLE "Warm"\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\nLUT_3D_SIZE 2\n\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n`,
    );
    expect(lut).toMatchObject({ title: 'Warm', dimensions: 3, size: 2 });
    expect(lut.table).toHaveLength(24);
  });

  it('says what is wrong, and where', () => {
    expect(() => parseCube('0 0 0\n')).toThrow('Line 1: values before LUT_3D_SIZE or LUT_1D_SIZE');
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 zero\n')).toThrow('Line 2: expected three numbers');
    expect(() => parseCube('LUT_3D_SIZE 2\nGAMMA 2.2\n')).toThrow(
      'Line 2: unknown keyword “GAMMA”',
    );
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n')).toThrow('1 values, but a 2³ LUT needs 8');
    expect(() => parseCube('TITLE "x"\n')).toThrow(LutError);
  });
});

describe('applyLut', () => {
  it('leaves every colour as it was through the identity', () => {
    const pixels = swatch();
    const before = Uint8ClampedArray.from(pixels);
    applyLut(pixels, identityLut(33));
    expect(pixels).toEqual(before);
  });

  it('matches the function a 33³ cube was made from, within 1/255 (the reference render)', () => {
    const f = (r: number, g: number, b: number): [number, number, number] => [
      smooth(r),
      0.8 * g + 0.2 * b,
      1 - smooth(b),
    ];
    const lut = parseCube(cubeOf(33, f));
    const pixels = swatch();
    const before = Uint8ClampedArray.from(pixels);
    applyLut(pixels, lut);
    for (let i = 0; i < pixels.length; i += 4) {
      const want = f(
        (before[i] ?? 0) / 255,
        (before[i + 1] ?? 0) / 255,
        (before[i + 2] ?? 0) / 255,
      );
      for (let c = 0; c < 3; c += 1) {
        expect(Math.abs((pixels[i + c] ?? 0) - (want[c] ?? 0) * 255)).toBeLessThanOrEqual(1);
      }
      expect(pixels[i + 3]).toBe(200);
    }
  });

  it('agrees with the single-colour lookup, and blends by intensity', () => {
    const lut = parseCube(cubeOf(9, (r, g, b) => [g, b, r]));
    const pixels = Uint8ClampedArray.from([200, 100, 50, 255]);
    applyLut(pixels, lut, 0.5);
    const out = new Float32Array(3);
    lookup(lut, 200 / 255, 100 / 255, 50 / 255, out);
    expect(Array.from(pixels.subarray(0, 3))).toEqual([150, 75, 125]);
    expect(Math.round((out[0] ?? 0) * 255)).toBe(100);
  });

  it('applies a 1D curve per channel', () => {
    const rows = ['LUT_1D_SIZE 1024'];
    for (let i = 0; i < 1024; i += 1) {
      const v = smooth(i / 1023).toFixed(6);
      rows.push(`${v} ${v} ${v}`);
    }
    const lut: Lut = parseCube(rows.join('\n'));
    expect(lut.dimensions).toBe(1);
    const pixels = swatch();
    const before = Uint8ClampedArray.from(pixels);
    applyLut(pixels, lut);
    for (let i = 0; i < pixels.length; i += 4) {
      expect(Math.abs((pixels[i] ?? 0) - smooth((before[i] ?? 0) / 255) * 255)).toBeLessThanOrEqual(
        1,
      );
    }
  });
});
