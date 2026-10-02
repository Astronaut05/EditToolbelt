/**
 * `text` engine for C06 LUT Converter: a `.cube` or `.3dl` in, the other (or
 * the same, resized) out. The maths is @etb/core's; LUT files are small, so
 * this runs on the main thread.
 */
import {
  format3dl,
  formatCube,
  LutError,
  parse3dl,
  parseCube,
  resample,
  to1d,
  type Lut,
} from '@etb/core';

import { EngineAbortError } from './dummy';
import { safeStem } from './names';
import type { Engine, EngineOutput } from './types';

export interface LutConvertOptions {
  /** cube or 3dl. */
  to?: string;
  /** keep, or a grid size: 17, 33 or 65. */
  grid?: string;
  /** keep, 3d or 1d. */
  shape?: string;
}

/** A 1D LUT made 3D without a grid chosen gets this many points a side. */
const DEFAULT_GRID = 33;

const describe = (lut: Lut, format: string) =>
  `${format} · ${lut.dimensions === 3 ? `3D, ${String(lut.size)}³` : `1D, ${String(lut.size)} points`}`;

export const lutConvertEngine: Engine<LutConvertOptions> = {
  capabilities: () => ({ supported: true }),
  estimate: () => ({ seconds: 0.3 }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const name = input instanceof File ? input.name : 'lut.cube';
    const text = await input.text();
    if (ctx.signal.aborted) throw new EngineAbortError();
    ctx.progress(0.2, 'Reading');
    // By the extension, else by the content: a .cube names its size, a .3dl is only numbers.
    const is3dl = /\.3dl$/i.test(name) || (!/\.cube$/i.test(name) && !/LUT_[13]D_SIZE/i.test(text));
    let lut: Lut;
    try {
      lut = is3dl ? parse3dl(text) : parseCube(text);
    } catch (error) {
      throw new Error(
        error instanceof LutError
          ? `This ${is3dl ? '.3dl' : '.cube'} file can’t be read. ${error.message}.`
          : 'This file can’t be read as a LUT.',
        { cause: error },
      );
    }
    const from = describe(lut, is3dl ? '.3dl' : '.cube');
    const to = opts.to === '3dl' ? '3dl' : 'cube';
    const grid = ['17', '33', '65'].includes(opts.grid ?? '') ? Number(opts.grid) : null;
    const notes: string[] = [];

    let out = lut;
    if (opts.shape === '1d') {
      if (to === '3dl') throw new Error('A .3dl is always 3D. Pick .cube for a 1D LUT.');
      const curves = to1d(lut);
      if (!curves) {
        throw new Error(
          'This LUT mixes the channels (a hue or saturation change), which three separate curves can’t do. Keep it 3D.',
        );
      }
      out = curves;
      if (lut.dimensions === 3)
        notes.push('Each channel only depends on itself, so three curves do the same');
    } else if (opts.shape === '3d' || to === '3dl' || grid !== null) {
      // A cube over the plain 0–1 domain, at the grid asked for, read with the LUT's own interpolation.
      const size = grid ?? (lut.dimensions === 3 ? lut.size : DEFAULT_GRID);
      const plain = lut.domainMin.every((v) => v === 0) && lut.domainMax.every((v) => v === 1);
      if (lut.dimensions === 1 || size !== lut.size || !plain) {
        out = resample(lut, size);
        if (lut.dimensions === 1) notes.push(`The curves made into a ${String(size)}³ cube`);
        else if (size !== lut.size) {
          notes.push(
            `Resampled from ${String(lut.size)}³ to ${String(size)}³, read with tetrahedral interpolation`,
          );
        }
        if (!plain) notes.push('Its input range made 0–1, as .3dl and most apps expect');
      }
    }
    ctx.progress(0.7, 'Writing');
    const stem = safeStem(name, 'lut');
    const suffix = out.dimensions === 3 && out.size !== lut.size ? `_${String(out.size)}` : '';
    let body: string;
    if (to === '3dl') {
      const written = format3dl(out);
      body = written.text;
      notes.push('12-bit values, a 10-bit input mesh: what Flame, Lustre and Nuke read');
      if (written.clipped > 0) {
        notes.push(
          `${written.clipped.toLocaleString('en-US')} values outside 0–1 were clipped: .3dl can’t hold them`,
        );
      }
    } else {
      body = formatCube(out, lut.title || stem);
    }
    ctx.progress(1, 'Done');
    return {
      blob: new Blob([body], { type: 'text/plain;charset=utf-8' }),
      ext: to,
      // "film_33.cube" when the grid changed; the shell keeps the rest of the original name.
      nameSuffix: suffix.replace(/^_/, ''),
      path: 'Browser',
      notes,
      details: [
        { label: 'From', value: from },
        { label: 'To', value: describe(out, `.${to}`) },
      ],
    };
  },
};
