import { describe, expect, it } from 'vitest';

import { identityLut, lookup, parseCube, type Lut } from './lut';
import { format3dl, formatCube, parse3dl, resample, to1d } from './lut-convert';

/** A 3D LUT from a function, red changing fastest. */
function cubeOf(
  size: number,
  f: (r: number, g: number, b: number) => [number, number, number],
): Lut {
  const lut = identityLut(size);
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        lut.table.set(
          f(r / (size - 1), g / (size - 1), b / (size - 1)),
          ((b * size + g) * size + r) * 3,
        );
      }
    }
  }
  return lut;
}

/** A warm look that mixes channels: red pulls in some green. */
const warm = (r: number, g: number, b: number): [number, number, number] => [
  Math.min(1, r * 0.9 + g * 0.1),
  g ** 1.1,
  b * 0.8,
];

const maxDiff = (a: Lut, b: Lut, samples = 9) => {
  const x = new Float32Array(3);
  const y = new Float32Array(3);
  let most = 0;
  for (let i = 0; i < samples; i += 1) {
    for (let j = 0; j < samples; j += 1) {
      for (let k = 0; k < samples; k += 1) {
        const [r, g, bl] = [i / (samples - 1), j / (samples - 1), k / (samples - 1)];
        lookup(a, r, g, bl, x);
        lookup(b, r, g, bl, y);
        for (let c = 0; c < 3; c += 1) most = Math.max(most, Math.abs((x[c] ?? 0) - (y[c] ?? 0)));
      }
    }
  }
  return most;
};

describe('.cube', () => {
  it('writes what parseCube reads back', () => {
    const lut = cubeOf(5, warm);
    const back = parseCube(formatCube(lut, 'Warm'));
    expect(back.title).toBe('Warm');
    expect(back.size).toBe(5);
    expect(maxDiff(lut, back)).toBeLessThan(1e-6);
  });

  it('keeps a domain that isn’t 0–1', () => {
    const lut = {
      ...cubeOf(3, warm),
      domainMin: [0, 0, 0] as [number, number, number],
      domainMax: [1.5, 1.5, 1.5] as [number, number, number],
    };
    expect(formatCube(lut, 'x')).toContain('DOMAIN_MAX 1.500000 1.500000 1.500000');
  });
});

describe('.3dl', () => {
  it('writes a 10-bit mesh and 12-bit values, blue fastest', () => {
    const { text, clipped } = format3dl(identityLut(3));
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe('0 512 1023');
    expect(lines).toHaveLength(1 + 27);
    expect(lines.slice(1, 5)).toEqual(['0 0 0', '0 0 2048', '0 0 4095', '0 2048 0']);
    expect(lines.at(-1)).toBe('4095 4095 4095');
    expect(clipped).toBe(0);
  });

  it('round-trips a cube within one 12-bit step', () => {
    const lut = cubeOf(17, warm);
    const back = parse3dl(format3dl(lut).text);
    expect(back.size).toBe(17);
    expect(maxDiff(lut, back)).toBeLessThan(1 / 4095 + 1e-6);
  });

  it('reads 10-bit values and files without a mesh line, and says what is wrong', () => {
    const tenBit = [
      '0 1023',
      ...[
        '0 0 0',
        '0 0 1023',
        '0 1023 0',
        '0 1023 1023',
        '1023 0 0',
        '1023 0 1023',
        '1023 1023 0',
        '1023 1023 1023',
      ],
    ].join('\n');
    expect(maxDiff(parse3dl(tenBit), identityLut(2))).toBeLessThan(1e-6);
    const noMesh = tenBit.split('\n').slice(1).join('\n');
    expect(parse3dl(noMesh).size).toBe(2);
    expect(() => parse3dl('0 512 1023\n0 0 0\n')).toThrow(/needs 27/);
    expect(() => parse3dl('LUT_3D_SIZE 2')).toThrow(/this isn’t a .3dl/);
  });

  it('takes the output depth from Lustre’s Mesh line when there is one', () => {
    // A 12-bit darkening LUT on a 2-point grid (2⁰ + 1): white goes to 1023 of 4095, a quarter.
    const values = [
      '0 0 0',
      '0 0 1023',
      '0 1023 0',
      '0 1023 1023',
      '1023 0 0',
      '1023 0 1023',
      '1023 1023 0',
      '1023 1023 1023',
    ];
    const white = (lut: Lut) => lut.table[lut.table.length - 1];
    const twelve = parse3dl(['3DMESH', 'Mesh 0 12', '0 1023', ...values].join('\n'));
    expect(white(twelve)).toBeCloseTo(1023 / 4095, 6);
    // Without the line, the largest value says 10-bit: white stays white.
    expect(white(parse3dl(['0 1023', ...values].join('\n')))).toBeCloseTo(1, 6);
    // A stated depth the values don't fit is ignored for the one they do.
    const wrong = parse3dl(
      ['Mesh 0 10', '0 1023', ...values.map((v) => v.replace(/1023/g, '4095'))].join('\n'),
    );
    expect(white(wrong)).toBeCloseTo(1, 6);
    // 16-bit stated, as Flame writes too.
    expect(white(parse3dl(['Mesh 0 16', '0 1023', ...values].join('\n')))).toBeCloseTo(
      1023 / 65535,
      6,
    );
  });

  it('clips values outside 0–1 and counts them', () => {
    const hot = cubeOf(2, (r, g, b) => [r * 1.2, g, b]);
    expect(format3dl(hot).clipped).toBe(4);
  });
});

describe('resample and 1D', () => {
  it('a resized cube grades the same as the original, between its points too', () => {
    const lut = cubeOf(17, warm);
    expect(maxDiff(lut, resample(lut, 65))).toBeLessThan(0.01);
    expect(maxDiff(resample(lut, 33), lut)).toBeLessThan(0.01);
  });

  it('a 1D LUT becomes a cube with the same curves', () => {
    const curve: Lut = {
      title: 'Gamma',
      dimensions: 1,
      size: 256,
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
      table: Float32Array.from({ length: 256 * 3 }, (_, i) => (Math.floor(i / 3) / 255) ** 0.8),
    };
    expect(maxDiff(curve, resample(curve, 33))).toBeLessThan(0.01);
  });

  it('a cube that is only curves becomes 1D; one that mixes channels can’t', () => {
    const curves = cubeOf(9, (r, g, b) => [r ** 0.9, g ** 1.1, b]);
    const flat = to1d(curves);
    expect(flat?.dimensions).toBe(1);
    expect(flat?.size).toBe(9);
    expect(maxDiff(curves, flat as Lut)).toBeLessThan(1e-6);
    expect(to1d(cubeOf(9, warm))).toBeNull();
  });
});
