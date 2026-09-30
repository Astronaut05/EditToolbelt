/**
 * GIF89a writing for V04: LZW-coded frames with a global or per-frame
 * palette, a loop count, and frame differencing (pixels that didn't change
 * become transparent, and each frame is cropped to what changed), which is
 * most of what keeps a video GIF small.
 */
import { buildPalette, Histogram, mapFrame, PaletteLookup, type Palette } from './quantize';

/** Palette slot kept for "unchanged" pixels in every frame. */
const TRANSPARENT = 255;

class Bytes {
  private buffer = new Uint8Array(1 << 16);
  length = 0;

  push(...values: number[]) {
    this.reserve(values.length);
    for (const v of values) this.buffer[this.length++] = v & 0xff;
  }

  u16(value: number) {
    this.push(value & 0xff, (value >> 8) & 0xff);
  }

  /** Rewrites a little-endian u16 written earlier. */
  setU16(at: number, value: number) {
    this.buffer[at] = value & 0xff;
    this.buffer[at + 1] = (value >> 8) & 0xff;
  }

  bytes(data: Uint8Array) {
    this.reserve(data.length);
    this.buffer.set(data, this.length);
    this.length += data.length;
  }

  private reserve(extra: number) {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }

  result(): Uint8Array<ArrayBuffer> {
    return this.buffer.slice(0, this.length);
  }
}

// One LZW table reused across calls; a generation stamp makes a reset free.
const table = new Int32Array(4096 * 256);
let generation = 0;

/** GIF's variable-width LZW, in 255-byte sub-blocks, ending with the block terminator. */
export function lzw(indices: Uint8Array, minCodeSize: number, out: Bytes): void {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let next = eoi + 1;
  let size = minCodeSize + 1;
  generation = (generation + 1) & 0x7ffff;
  let bits = 0;
  let bitCount = 0;
  const block = new Uint8Array(255);
  let blockLength = 0;
  out.push(minCodeSize);
  const flushByte = (byte: number) => {
    block[blockLength++] = byte;
    if (blockLength === 255) {
      out.push(255);
      out.bytes(block);
      blockLength = 0;
    }
  };
  const emit = (code: number) => {
    bits |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      flushByte(bits & 0xff);
      bits >>>= 8;
      bitCount -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0] ?? 0;
  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i] ?? 0;
    const key = (prefix << 8) | k;
    const entry = table[key] ?? 0;
    if (entry >>> 12 === generation) {
      prefix = entry & 0xfff;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      size = minCodeSize + 1;
      generation = (generation + 1) & 0x7ffff;
    } else {
      if (next >= 1 << size) size += 1;
      table[key] = (generation << 12) | next;
      next += 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bitCount > 0) flushByte(bits & 0xff);
  if (blockLength > 0) {
    out.push(blockLength);
    out.bytes(block.subarray(0, blockLength));
  }
  out.push(0);
}

export interface GifOptions {
  width: number;
  height: number;
  fps: number;
  /** 0 plays forever; 1 plays once (no loop block); n plays n times. */
  plays: number;
  palette: 'global' | 'frame';
  dither: boolean;
}

/** Centiseconds per frame, spread so the average holds (12 fps → 8, 8, 9, …). */
export function frameDelays(count: number, fps: number): number[] {
  const at = (k: number) => Math.round((k * 100) / fps);
  return Array.from({ length: count }, (_, k) => Math.max(2, at(k + 1) - at(k)));
}

function writeColourTable(out: Bytes, palette: Palette) {
  const entries = new Uint8Array(256 * 3);
  entries.set(palette.subarray(0, Math.min(palette.length, 255 * 3)));
  out.bytes(entries);
}

/**
 * Encodes RGBA frames (all width × height) as an animated GIF. `progress`
 * gets 0-1 as frames are written.
 */
export function encodeGif(
  frames: (Uint8Array | Uint8ClampedArray)[],
  options: GifOptions,
  progress: (fraction: number) => void = () => undefined,
): Uint8Array<ArrayBuffer> {
  const { width, height } = options;
  const out = new Bytes();
  const pixels = width * height;

  // Pass 1: one palette for the whole clip, from every frame (sampled when large).
  let global: Palette | null = null;
  if (options.palette === 'global') {
    const histogram = new Histogram();
    const step = Math.max(1, Math.floor((pixels * frames.length) / 4_000_000));
    for (const frame of frames) histogram.add(frame, step);
    global = buildPalette(histogram, 255);
  }

  out.push(...Array.from('GIF89a', (c) => c.charCodeAt(0)));
  out.u16(width);
  out.u16(height);
  // Global colour table flag, 8-bit colour resolution, 256 entries.
  out.push(global ? 0xf7 : 0x70, 0, 0);
  if (global) writeColourTable(out, global);
  if (options.plays !== 1) {
    out.push(0x21, 0xff, 0x0b, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 3, 1);
    // Repeats after the first play; 0 is forever.
    out.u16(options.plays === 0 ? 0 : options.plays - 1);
    out.push(0);
  }

  const delays = frameDelays(frames.length, options.fps);
  // What's on screen so far, as RGB, to find what changed.
  const shown = new Int16Array(pixels * 3).fill(-1);
  // Where the last written frame's delay sits, to lengthen it for unchanged frames.
  let lastDelayAt = -1;
  let lastDelay = 0;
  for (const [index, frame] of frames.entries()) {
    const palette = global ?? frameOwnPalette(frame);
    const indices = mapFrame(
      frame,
      width,
      height,
      palette,
      new PaletteLookup(palette),
      options.dither,
    );
    // Unchanged pixels become transparent; crop to the box that changed.
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let p = 0; p < pixels; p += 1) {
      const c = indices[p] ?? 0;
      const r = palette[c * 3] ?? 0;
      const g = palette[c * 3 + 1] ?? 0;
      const b = palette[c * 3 + 2] ?? 0;
      if (shown[p * 3] === r && shown[p * 3 + 1] === g && shown[p * 3 + 2] === b) {
        indices[p] = TRANSPARENT;
        continue;
      }
      shown[p * 3] = r;
      shown[p * 3 + 1] = g;
      shown[p * 3 + 2] = b;
      const x = p % width;
      const y = (p - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const delay = delays[index] ?? 8;
    if (maxX < 0 && lastDelayAt >= 0) {
      // Nothing changed: the frame on screen stays up longer instead.
      lastDelay = Math.min(0xffff, lastDelay + delay);
      out.setU16(lastDelayAt, lastDelay);
      progress((index + 1) / frames.length);
      continue;
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const cropped = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      cropped.set(
        indices.subarray((minY + y) * width + minX, (minY + y) * width + minX + w),
        y * w,
      );
    }
    // Graphic control: keep the frame (disposal 1), transparent slot 255.
    out.push(0x21, 0xf9, 4, (1 << 2) | 1);
    lastDelayAt = out.length;
    lastDelay = delay;
    out.u16(delay);
    out.push(TRANSPARENT, 0);
    out.push(0x2c);
    out.u16(minX);
    out.u16(minY);
    out.u16(w);
    out.u16(h);
    out.push(global ? 0 : 0x87);
    if (!global) writeColourTable(out, palette);
    lzw(cropped, 8, out);
    progress((index + 1) / frames.length);
  }
  out.push(0x3b);
  return out.result();
}

function frameOwnPalette(frame: Uint8Array | Uint8ClampedArray): Palette {
  const histogram = new Histogram();
  histogram.add(frame, Math.max(1, Math.floor(frame.length / 4 / 250_000)));
  return buildPalette(histogram, 255);
}
