import { describe, expect, it } from 'vitest';

import { encodeGif, frameDelays } from './encode';
import { imageChunks, muxAnimatedWebp } from './webp';
import { buildPalette, Histogram, mapFrame, PaletteLookup } from './quantize';

/** A small GIF reader: enough to check what the encoder wrote. */
function readGif(bytes: Uint8Array) {
  let at = 6;
  const u16 = () => {
    const v = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
    at += 2;
    return v;
  };
  const width = u16();
  const height = u16();
  const packed = bytes[at] ?? 0;
  at += 3;
  let global: Uint8Array | null = null;
  if (packed & 0x80) {
    const size = 3 * (1 << ((packed & 7) + 1));
    global = bytes.slice(at, at + size);
    at += size;
  }
  let loops: number | null = null;
  let delay = 0;
  let transparent = -1;
  const frames: {
    x: number;
    y: number;
    w: number;
    h: number;
    delay: number;
    pixels: number[][];
  }[] = [];
  const canvas: number[][] = Array.from({ length: width * height }, () => [0, 0, 0]);
  while (at < bytes.length) {
    const kind = bytes[at++];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) {
        const flags = bytes[at + 1] ?? 0;
        delay = (bytes[at + 2] ?? 0) | ((bytes[at + 3] ?? 0) << 8);
        transparent = flags & 1 ? (bytes[at + 4] ?? 0) : -1;
      }
      if (
        label === 0xff &&
        String.fromCharCode(...bytes.slice(at + 1, at + 12)) === 'NETSCAPE2.0'
      ) {
        loops = (bytes[at + 14] ?? 0) | ((bytes[at + 15] ?? 0) << 8);
      }
      for (let size = bytes[at] ?? 0; size > 0; size = bytes[at] ?? 0) at += size + 1;
      at += 1;
      continue;
    }
    // Image descriptor.
    const x = u16();
    const y = u16();
    const w = u16();
    const h = u16();
    const flags = bytes[at++] ?? 0;
    let table = global;
    if (flags & 0x80) {
      const size = 3 * (1 << ((flags & 7) + 1));
      table = bytes.slice(at, at + size);
      at += size;
    }
    const minCode = bytes[at++] ?? 2;
    const data: number[] = [];
    for (let size = bytes[at] ?? 0; size > 0; size = bytes[at] ?? 0) {
      data.push(...bytes.slice(at + 1, at + 1 + size));
      at += size + 1;
    }
    at += 1;
    const indices = lzwDecode(Uint8Array.from(data), minCode, w * h);
    const pixels = Array.from(indices, (i) => [
      table?.[i * 3] ?? 0,
      table?.[i * 3 + 1] ?? 0,
      table?.[i * 3 + 2] ?? 0,
    ]);
    indices.forEach((i, p) => {
      if (i === transparent) return;
      canvas[(y + Math.floor(p / w)) * width + x + (p % w)] = pixels[p] ?? [0, 0, 0];
    });
    frames.push({ x, y, w, h, delay, pixels: canvas.map((c) => [...c]) });
  }
  return { width, height, loops, frames };
}

function lzwDecode(data: Uint8Array, minCode: number, count: number): number[] {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, i) => [i]);
    size = minCode + 1;
  };
  reset();
  const out: number[] = [];
  let bit = 0;
  let previous: number[] | null = null;
  while (out.length < count) {
    let code = 0;
    for (let i = 0; i < size; i += 1, bit += 1) {
      code |= (((data[bit >> 3] ?? 0) >> (bit & 7)) & 1) << i;
    }
    if (code === clear) {
      reset();
      previous = null;
      continue;
    }
    if (code === eoi) break;
    const entry: number[] = dict[code] ?? (previous ? [...previous, previous[0] ?? 0] : []);
    out.push(...entry);
    if (previous) dict.push([...previous, entry[0] ?? 0]);
    previous = entry;
    if (dict.length === 1 << size && size < 12) size += 1;
  }
  return out;
}

const solid = (w: number, h: number, rgb: [number, number, number]) => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) data.set([...rgb, 255], i * 4);
  return data;
};

describe('palette', () => {
  it('keeps a few distinct colours exact', () => {
    const h = new Histogram();
    const colours: [number, number, number][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ];
    for (const c of colours) h.add(solid(4, 4, c));
    const palette = buildPalette(h, 16);
    const lookup = new PaletteLookup(palette);
    for (const c of colours) {
      const i = lookup.nearest(...c);
      expect(Array.from(palette.slice(i * 3, i * 3 + 3))).toEqual(c);
    }
  });

  it('maps a gradient without banding when dithered', () => {
    const w = 64;
    const frame = new Uint8Array(w * 4 * 4);
    for (let p = 0; p < w * 4; p += 1) frame.set([(p % w) * 4, 0, 0, 255], p * 4);
    const h = new Histogram();
    h.add(frame);
    const palette = buildPalette(h, 4);
    const lookup = new PaletteLookup(palette);
    const plain = mapFrame(frame, w, 4, palette, lookup, false);
    const dithered = mapFrame(frame, w, 4, palette, lookup, true);
    // Dithering mixes neighbouring entries along the ramp; plain mapping gives flat runs.
    const switches = (row: Uint8Array) => row.slice(1).filter((v, i) => v !== row[i]).length;
    expect(switches(dithered.slice(0, w))).toBeGreaterThan(switches(plain.slice(0, w)));
  });
});

describe('GIF', () => {
  it('spreads delays so the frame rate holds', () => {
    expect(frameDelays(6, 12)).toEqual([8, 9, 8, 8, 9, 8]);
    expect(frameDelays(4, 10)).toEqual([10, 10, 10, 10]);
    expect(frameDelays(120, 12).reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('writes frames that decode back, crops what changed and merges what did not', () => {
    const w = 8;
    const h = 6;
    const red = solid(w, h, [255, 0, 0]);
    const withSquare = red.slice();
    for (const [x, y] of [
      [3, 2],
      [4, 2],
      [3, 3],
      [4, 3],
    ] as const) {
      withSquare.set([0, 0, 255, 255], (y * w + x) * 4);
    }
    const gif = encodeGif([red, withSquare, withSquare.slice()], {
      width: w,
      height: h,
      fps: 10,
      plays: 0,
      palette: 'global',
      dither: false,
    });
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a');
    const read = readGif(gif);
    expect([read.width, read.height, read.loops]).toEqual([8, 6, 0]);
    expect(read.frames).toHaveLength(2);
    expect(read.frames[1]).toMatchObject({ x: 3, y: 2, w: 2, h: 2, delay: 20 });
    expect(read.frames[1]?.pixels[2 * w + 3]).toEqual([0, 0, 255]);
    expect(read.frames[1]?.pixels[0]).toEqual([255, 0, 0]);
  });

  it('plays once without a loop block, and takes per-frame palettes', () => {
    const frames = [solid(4, 4, [10, 200, 30]), solid(4, 4, [200, 10, 30])];
    const gif = encodeGif(frames, {
      width: 4,
      height: 4,
      fps: 12,
      plays: 1,
      palette: 'frame',
      dither: true,
    });
    const read = readGif(gif);
    expect(read.loops).toBeNull();
    expect(read.frames).toHaveLength(2);
    expect(read.frames[1]?.pixels[5]).toEqual([200, 10, 30]);
  });

  it('survives long runs past the 4096-code table', () => {
    const w = 300;
    const h = 200;
    const frame = new Uint8Array(w * h * 4);
    let seed = 1;
    for (let p = 0; p < w * h; p += 1) {
      seed = (seed * 48271) % 2147483647;
      frame.set([seed & 0xff, (seed >> 8) & 0xff, (seed >> 16) & 0xff, 255], p * 4);
    }
    const gif = encodeGif([frame], {
      width: w,
      height: h,
      fps: 10,
      plays: 0,
      palette: 'global',
      dither: false,
    });
    const read = readGif(gif);
    expect(read.frames[0]?.w).toBe(w);
    expect(read.frames[0]?.pixels).toHaveLength(w * h);
  });
});

describe('animated WebP', () => {
  const single = (payload: number[]) => {
    const chunk = [
      ...Array.from('VP8L', (c) => c.charCodeAt(0)),
      payload.length,
      0,
      0,
      0,
      ...payload,
    ];
    if (payload.length % 2) chunk.push(0);
    const body = [...Array.from('WEBP', (c) => c.charCodeAt(0)), ...chunk];
    return Uint8Array.from([
      ...Array.from('RIFF', (c) => c.charCodeAt(0)),
      body.length,
      0,
      0,
      0,
      ...body,
    ]);
  };

  it('moves each frame’s image chunk into ANMF frames with its duration', () => {
    const a = single([1, 2, 3]);
    expect(Array.from(imageChunks(a))).toEqual([86, 80, 56, 76, 3, 0, 0, 0, 1, 2, 3, 0]);
    const webp = muxAnimatedWebp(
      [
        { webp: a, durationMs: 83 },
        { webp: single([4, 5]), durationMs: 84 },
      ],
      320,
      180,
      0,
      false,
    );
    const text = (at: number) => String.fromCharCode(...webp.slice(at, at + 4));
    expect([text(0), text(8), text(12)]).toEqual(['RIFF', 'WEBP', 'VP8X']);
    const riffSize = (webp[4] ?? 0) | ((webp[5] ?? 0) << 8);
    expect(riffSize).toBe(webp.length - 8);
    // Canvas width - 1 = 319, little-endian 24-bit, after flags and 3 reserved bytes.
    expect((webp[24] ?? 0) | ((webp[25] ?? 0) << 8)).toBe(319);
    expect(text(30)).toBe('ANIM');
    const firstFrame = 30 + 8 + 6;
    expect(text(firstFrame)).toBe('ANMF');
    // Duration sits after X, Y, width-1 and height-1 (4 × 3 bytes).
    const duration = firstFrame + 8 + 12;
    expect((webp[duration] ?? 0) | ((webp[duration + 1] ?? 0) << 8)).toBe(83);
  });
});
