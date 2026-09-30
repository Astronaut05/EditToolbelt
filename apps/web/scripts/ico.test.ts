import { describe, expect, it } from 'vitest';

import { pngToIco } from './ico.ts';

describe('pngToIco', () => {
  it('writes one PNG image after a 22-byte header', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const ico = pngToIco(png, 32);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect(ico.readUInt8(6)).toBe(32);
    expect(ico.readUInt32LE(14)).toBe(png.length);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(ico.subarray(22)).toEqual(png);
  });

  it('refuses sizes an .ico cannot hold', () => {
    expect(() => pngToIco(Buffer.alloc(1), 512)).toThrow();
  });
});
