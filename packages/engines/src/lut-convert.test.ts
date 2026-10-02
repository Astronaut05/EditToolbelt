import { formatCube, identityLut, parse3dl, parseCube, type Lut } from '@etb/core';
import { describe, expect, it } from 'vitest';

import { lutConvertEngine, type LutConvertOptions } from './lut-convert';

const ctx = () => ({ signal: new AbortController().signal, progress: () => undefined });

/** A 3D cube of `size` from a function, red changing fastest, as a .cube file. */
function cube(size: number, f: (r: number, g: number, b: number) => number[], title = 'Look') {
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
  return new File([formatCube(lut, title)], 'look.cube');
}

/** A 1D LUT of three curves, as a .cube file. */
const curves = (points: number) =>
  new File(
    [
      [
        `LUT_1D_SIZE ${String(points)}`,
        ...Array.from({ length: points }, (_, i) => {
          const v = (i / (points - 1)) ** 2;
          return `${v.toFixed(6)} ${v.toFixed(6)} ${v.toFixed(6)}`;
        }),
      ].join('\n'),
    ],
    'curve.cube',
  );

async function convert(file: File, opts: LutConvertOptions) {
  const out = await lutConvertEngine.run(file, opts, ctx());
  const text = await out.blob.text();
  const lut: Lut = out.ext === '3dl' ? parse3dl(text) : parseCube(text);
  return { out, lut };
}

const separable = (r: number, g: number, b: number) => [r ** 2, g ** 0.5, b];
const mixing = (r: number, g: number, b: number) => [r * 0.8 + g * 0.2, g, b];

describe('lutConvertEngine: shape and grid', () => {
  it('writes a .3dl at the cube’s own grid by default', async () => {
    const { out, lut } = await convert(cube(5, separable), { to: '3dl' });
    expect(out.ext).toBe('3dl');
    expect([lut.dimensions, lut.size]).toEqual([3, 5]);
    // Same grid: no size in the name.
    expect(out.nameSuffix).toBe('');
    expect(out.details).toEqual([
      { label: 'From', value: '.cube · 3D, 5³' },
      { label: 'To', value: '.3dl · 3D, 5³' },
    ]);
  });

  it('resamples to the grid picked, and names the file after it', async () => {
    const { out, lut } = await convert(cube(5, separable), { to: 'cube', grid: '17' });
    expect([lut.dimensions, lut.size]).toEqual([3, 17]);
    expect(out.nameSuffix).toBe('17');
    expect(out.notes).toContain('Resampled from 5³ to 17³, read with tetrahedral interpolation');
    // A grid that isn't offered is ignored: kept as it was.
    const kept = await convert(cube(5, separable), { to: 'cube', grid: '20' });
    expect(kept.lut.size).toBe(5);
    expect(kept.out.nameSuffix).toBe('');
  });

  it('makes a 1D LUT a 33³ cube unless a grid is picked', async () => {
    const made = await convert(curves(9), { to: 'cube', shape: '3d' });
    expect([made.lut.dimensions, made.lut.size]).toEqual([3, 33]);
    expect(made.out.notes).toContain('The curves made into a 33³ cube');
    // A .3dl is always 3D, so it's made a cube too.
    const dl = await convert(curves(9), { to: '3dl', grid: '17' });
    expect([dl.lut.dimensions, dl.lut.size]).toEqual([3, 17]);
    // Kept as it is: still three curves.
    const same = await convert(curves(9), { to: 'cube' });
    expect([same.lut.dimensions, same.lut.size]).toEqual([1, 9]);
  });

  it('turns a cube into three curves only when the channels don’t mix', async () => {
    const flat = await convert(cube(5, separable), { to: 'cube', shape: '1d' });
    expect([flat.lut.dimensions, flat.lut.size]).toEqual([1, 5]);
    expect(flat.out.notes).toContain(
      'Each channel only depends on itself, so three curves do the same',
    );
    await expect(
      lutConvertEngine.run(cube(5, mixing), { to: 'cube', shape: '1d' }, ctx()),
    ).rejects.toThrow(/mixes the channels/);
    await expect(
      lutConvertEngine.run(cube(5, separable), { to: '3dl', shape: '1d' }, ctx()),
    ).rejects.toThrow(/always 3D/);
  });

  it('makes an input range other than 0–1 plain for a .3dl', async () => {
    const ranged = new File(
      [
        [
          'LUT_3D_SIZE 2',
          'DOMAIN_MIN 0 0 0',
          'DOMAIN_MAX 2 2 2',
          ...Array.from({ length: 8 }, (_, i) =>
            [i & 1, (i >> 1) & 1, (i >> 2) & 1].map((v) => String(v * 2)).join(' '),
          ),
        ].join('\n'),
      ],
      'wide.cube',
    );
    const { out, lut } = await convert(ranged, { to: '3dl' });
    expect(out.notes).toContain('Its input range made 0–1, as .3dl and most apps expect');
    expect([lut.dimensions, lut.size]).toEqual([3, 2]);
  });

  it('says which file couldn’t be read', async () => {
    await expect(
      lutConvertEngine.run(new File(['LUT_3D_SIZE 2\n0 0'], 'bad.cube'), {}, ctx()),
    ).rejects.toThrow(/This \.cube file can’t be read/);
  });
});
