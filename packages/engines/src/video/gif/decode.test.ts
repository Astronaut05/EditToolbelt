import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { gifFrames, GifReadError, interlacedRows, lzwDecode, readGif } from './decode';
import { encodeGif } from './encode';

/** Solid RGBA frames with a moving 4 × 4 square, in a few exact colours. */
function frames(count: number, width = 16, height = 12): Uint8Array[] {
  return Array.from({ length: count }, (_, k) => {
    const rgba = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p += 1) {
      const x = p % width;
      const y = Math.floor(p / width);
      const square = x >= k * 2 && x < k * 2 + 4 && y >= 4 && y < 8;
      rgba.set(square ? [240, 32, 16, 255] : [16, 64, 200, 255], p * 4);
    }
    return rgba;
  });
}

const encode = (input: Uint8Array[], plays = 0) =>
  encodeGif(input, {
    width: 16,
    height: 12,
    fps: 10,
    plays,
    palette: 'global',
    dither: false,
  });

/** Every frame as its own copy (the generator reuses one buffer). */
const snapshots = (gif: ReturnType<typeof readGif>) =>
  Array.from(gifFrames(gif), ({ rgba }) => rgba.slice());

/** Offsets of each frame's delay in a GIF (after each 21 F9 04 xx). */
function delayOffsets(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length - 4; i += 1) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 4) out.push(i + 4);
  }
  return out;
}

describe('GIF reading', () => {
  it('reads back what the encoder wrote, frame by frame', () => {
    const input = frames(4);
    const gif = readGif(encode(input));
    expect(gif).toMatchObject({ width: 16, height: 12, plays: 0 });
    expect(gif.frames).toHaveLength(4);
    let k = 0;
    for (const { rgba } of gifFrames(gif)) {
      const original = input[k] ?? new Uint8Array();
      // The palette holds these colours exactly, so every pixel comes back.
      let diff = 0;
      for (let i = 0; i < rgba.length; i += 1)
        diff = Math.max(diff, Math.abs((rgba[i] ?? 0) - (original[i] ?? 0)));
      expect(diff, `frame ${String(k)}`).toBeLessThanOrEqual(2);
      k += 1;
    }
    expect(k).toBe(4);
  });

  it('keeps variable delays, and plays 0 and 10 ms delays at 100 ms like browsers', () => {
    const bytes = encode(frames(4)).slice();
    const offsets = delayOffsets(bytes);
    expect(offsets).toHaveLength(4);
    [3, 7, 1, 25].forEach((cs, i) => {
      bytes[offsets[i] ?? 0] = cs;
    });
    const gif = readGif(bytes);
    expect(gif.frames.map((f) => f.rawDelayMs)).toEqual([30, 70, 10, 250]);
    expect(gif.frames.map((f) => f.delayMs)).toEqual([30, 70, 100, 250]);
    expect(gif.durationMs).toBe(450);
  });

  it('reads the loop count', () => {
    expect(readGif(encode(frames(2), 1)).plays).toBe(1);
    expect(readGif(encode(frames(2), 3)).plays).toBe(3);
  });

  it('clears a frame’s area to transparent with disposal 2', () => {
    const bytes = encode(frames(2)).slice();
    const [first] = delayOffsets(bytes);
    // Flags byte sits just before the delay: disposal 2, keep the transparency flag.
    bytes[(first ?? 0) - 1] = (2 << 2) | 1;
    const [, second] = snapshots(readGif(bytes));
    // Frame 2 only drew what changed, so the rest of frame 1's area is now clear.
    expect(second?.[3]).toBe(0);
    // A pixel of the second square is drawn.
    expect(second?.[(5 * 16 + 4) * 4 + 3]).toBe(255);
  });

  it('reads the fixture made by another writer: delays, transparency, pixels', () => {
    const bytes = readFileSync(
      fileURLToPath(new URL('../../../../../fixtures/video/anim-delays.gif', import.meta.url)),
    );
    const gif = readGif(bytes);
    expect(gif).toMatchObject({ width: 64, height: 48, plays: 0, durationMs: 600 });
    expect(gif.frames.map((f) => f.delayMs)).toEqual([30, 70, 100, 250, 40, 110]);
    const shots = snapshots(gif);
    const pixel = (frame: number, x: number, y: number) =>
      Array.from(shots[frame]?.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4) ?? []);
    // Frame 1: the blue is transparent, the square is red.
    expect(pixel(0, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(0, 4, 16)).toEqual([240, 32, 16, 255]);
    // Frame 2 is opaque, with the square 8 px on.
    expect(pixel(1, 0, 0)).toEqual([16, 64, 200, 255]);
    expect(pixel(1, 12, 16)).toEqual([240, 32, 16, 255]);
    expect(pixel(1, 4, 16)).toEqual([16, 64, 200, 255]);
  });

  it('orders interlaced rows 0, 8, 4, 2, 6, 1, 3, 5, 7', () => {
    expect(interlacedRows(9)).toEqual([0, 8, 4, 2, 6, 1, 3, 5, 7]);
  });

  it('stops at damaged data instead of throwing', () => {
    expect(lzwDecode(new Uint8Array([0xff, 0xff, 0xff]), 2, 10)).toHaveLength(10);
    expect(() => readGif(new TextEncoder().encode('not a gif'))).toThrow(GifReadError);
  });
});
