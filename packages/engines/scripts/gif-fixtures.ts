/**
 * Makes the GIF to MP4 fixture, fixtures/video/anim-delays.gif: 64 × 48 px,
 * six full frames of a red square moving over blue, with the delays 30, 70,
 * 0 (played at 100), 250, 40 and 110 ms, and the first frame's blue
 * transparent. Written here byte by byte (4-colour palette, LZW codes kept at
 * 3 bits by a clear code every two pixels), independent of our GIF encoder.
 * Run from the repo root: node packages/engines/scripts/gif-fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/video');
const WIDTH = 64;
const HEIGHT = 48;
const DELAYS_CS = [3, 7, 0, 25, 4, 11];
// Palette: 0 blue, 1 red, 2 black, 3 white.
const PALETTE = [16, 64, 200, 240, 32, 16, 0, 0, 0, 255, 255, 255];

const out: number[] = [];
const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);

/** 3-bit LZW codes, with a clear code before every two pixels so the table never grows. */
function lzw(indices: number[]): number[] {
  const codes: number[] = [];
  for (let i = 0; i < indices.length; i += 2) {
    codes.push(4, ...indices.slice(i, i + 2));
  }
  codes.push(5);
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const code of codes) {
    buffer |= code << bits;
    bits += 3;
    while (bits >= 8) {
      bytes.push(buffer & 0xff);
      buffer >>= 8;
      bits -= 8;
    }
  }
  if (bits > 0) bytes.push(buffer & 0xff);
  return bytes;
}

out.push(...Buffer.from('GIF89a'));
u16(WIDTH);
u16(HEIGHT);
// Global colour table of 4 entries, colour resolution 2 bits.
out.push(0x91, 0, 0, ...PALETTE);
// Loop forever.
out.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
DELAYS_CS.forEach((delay, k) => {
  const first = k === 0;
  // Disposal 1 (keep); the first frame's blue (0) is transparent.
  out.push(0x21, 0xf9, 4, (1 << 2) | (first ? 1 : 0));
  u16(delay);
  out.push(0, 0);
  out.push(0x2c);
  u16(0);
  u16(0);
  u16(WIDTH);
  u16(HEIGHT);
  out.push(0);
  const indices: number[] = [];
  for (let p = 0; p < WIDTH * HEIGHT; p += 1) {
    const x = p % WIDTH;
    const y = Math.floor(p / WIDTH);
    indices.push(x >= 4 + k * 8 && x < 20 + k * 8 && y >= 16 && y < 32 ? 1 : 0);
  }
  out.push(2);
  const data = lzw(indices);
  for (let i = 0; i < data.length; i += 255) {
    const block = data.slice(i, i + 255);
    out.push(block.length, ...block);
  }
  out.push(0);
});
out.push(0x3b);

writeFileSync(join(DIR, 'anim-delays.gif'), Uint8Array.from(out));
console.log(`anim-delays.gif: ${String(out.length)} bytes`);
