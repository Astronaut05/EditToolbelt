/**
 * GIF reading for V05: the frames as full RGBA pictures, composed the way
 * browsers show them (disposal, transparency, interlacing), each with its
 * delay. `readGif` scans the file once for its size, loop count and frame
 * list; `gifFrames` then decodes one frame at a time, so a long GIF never
 * sits in memory as pictures.
 */

export class GifReadError extends Error {}

export interface GifFrameInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Milliseconds, as browsers play it: 0 and 10 ms delays become 100 ms. */
  delayMs: number;
  /** The delay the file asks for, in ms. */
  rawDelayMs: number;
  /** 0-1 none, 2 clear to transparent, 3 restore what was there before. */
  disposal: number;
  transparent: number | null;
  interlaced: boolean;
  palette: Uint8Array;
  minCodeSize: number;
  /** The LZW data's sub-blocks, joined. */
  data: Uint8Array;
}

export interface GifInfo {
  width: number;
  height: number;
  /** 0 plays forever; otherwise how many times the GIF plays in all. */
  plays: number;
  /** The screen's background colour from the file (players ignore it; so do we). */
  frames: GifFrameInfo[];
  durationMs: number;
}

/** Browsers play delays of 10 ms or less at 100 ms; so do we, or fast GIFs would race. */
export function playedDelay(rawMs: number): number {
  return rawMs <= 10 ? 100 : rawMs;
}

export function readGif(bytes: Uint8Array): GifInfo {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    throw new GifReadError('This isn’t a GIF. Drop an animated .gif file.');
  }
  let at = 6;
  const byte = () => {
    if (at >= bytes.length) throw new GifReadError('This GIF is cut short.');
    return bytes[at++] ?? 0;
  };
  const u16 = () => byte() | (byte() << 8);
  const table = (packed: number) => {
    const size = 3 * (1 << ((packed & 7) + 1));
    if (at + size > bytes.length) throw new GifReadError('This GIF is cut short.');
    const out = bytes.subarray(at, at + size);
    at += size;
    return out;
  };
  const subBlocks = (): Uint8Array[] => {
    const parts: Uint8Array[] = [];
    for (let length = byte(); length > 0; length = byte()) {
      parts.push(bytes.subarray(at, Math.min(bytes.length, at + length)));
      at += length;
    }
    return parts;
  };

  const width = u16();
  const height = u16();
  const packed = byte();
  at += 2; // background colour index, aspect ratio
  const global = packed & 0x80 ? table(packed) : null;
  if (width === 0 || height === 0) throw new GifReadError('This GIF has no picture in it.');

  let plays = 1;
  let delay = 0;
  let disposal = 0;
  let transparent: number | null = null;
  const frames: GifFrameInfo[] = [];
  while (at < bytes.length) {
    const kind = byte();
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = byte();
      const blocks = subBlocks();
      const first = blocks[0];
      if (label === 0xf9 && first && first.length >= 4) {
        const flags = first[0] ?? 0;
        disposal = (flags >> 2) & 7;
        delay = ((first[1] ?? 0) | ((first[2] ?? 0) << 8)) * 10;
        transparent = flags & 1 ? (first[3] ?? 0) : null;
      } else if (label === 0xff && first && String.fromCharCode(...first) === 'NETSCAPE2.0') {
        const loop = blocks[1];
        if (loop && loop[0] === 1) {
          const repeats = (loop[1] ?? 0) | ((loop[2] ?? 0) << 8);
          plays = repeats === 0 ? 0 : repeats + 1;
        }
      }
      continue;
    }
    if (kind !== 0x2c) {
      // Junk after the last frame is common; stop at it once there is a frame.
      if (frames.length > 0) break;
      throw new GifReadError('This GIF is damaged: a block of an unknown kind.');
    }
    const x = u16();
    const y = u16();
    const w = u16();
    const h = u16();
    const flags = byte();
    const local = flags & 0x80 ? table(flags) : null;
    const minCodeSize = byte();
    const parts = subBlocks();
    const palette = local ?? global;
    if (!palette) throw new GifReadError('This GIF is damaged: a frame has no colours.');
    if (minCodeSize < 2 || minCodeSize > 8) {
      throw new GifReadError('This GIF is damaged: a frame’s data is unreadable.');
    }
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.length;
    }
    frames.push({
      x,
      y,
      width: w,
      height: h,
      delayMs: playedDelay(delay),
      rawDelayMs: delay,
      disposal,
      transparent,
      interlaced: (flags & 0x40) !== 0,
      palette,
      minCodeSize,
      data,
    });
    delay = 0;
    disposal = 0;
    transparent = null;
  }
  if (frames.length === 0) throw new GifReadError('This GIF has no frames in it.');
  return {
    width,
    height,
    plays,
    frames,
    durationMs: frames.reduce((sum, f) => sum + f.delayMs, 0),
  };
}

/** Palette indices for one frame, `pixels` long (short data leaves the rest 0). */
export function lzwDecode(data: Uint8Array, minCodeSize: number, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  // Each code is a prefix code plus a last byte; its first byte and length make output fast.
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let c = 0; c < clear; c += 1) {
    prefix[c] = -1;
    suffix[c] = c;
    first[c] = c;
    length[c] = 1;
  }
  let size = minCodeSize + 1;
  let next = end + 1;
  let previous = -1;
  let written = 0;
  let bits = 0;
  let buffer = 0;
  let at = 0;
  while (written < pixels) {
    while (bits < size) {
      if (at >= data.length) return out;
      buffer |= (data[at++] ?? 0) << bits;
      bits += 8;
    }
    const code = buffer & ((1 << size) - 1);
    buffer >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCodeSize + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) break;
    if (previous === -1) {
      if (code >= clear) return out;
      out[written++] = code;
      previous = code;
      continue;
    }
    // A code past the next free one is damage: keep what was read.
    if (code > next) return out;
    if (next < 4096) {
      // The new entry is the previous string plus the first byte of this one; when
      // this code is the one being defined, that first byte is the previous one's.
      prefix[next] = previous;
      suffix[next] = code === next ? (first[previous] ?? 0) : (first[code] ?? 0);
      first[next] = first[previous] ?? 0;
      length[next] = (length[previous] ?? 0) + 1;
      next += 1;
      if (next === 1 << size && size < 12) size += 1;
    }
    // The code's bytes, written back to front along its prefix chain.
    const count = length[code] ?? 0;
    let c = code;
    for (let i = count - 1; i >= 0; i -= 1) {
      if (written + i < pixels) out[written + i] = suffix[c] ?? 0;
      c = prefix[c] ?? 0;
    }
    written += count;
    previous = code;
  }
  return out;
}

/** Row order of an interlaced frame: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1. */
export function interlacedRows(height: number): number[] {
  const rows: number[] = [];
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const) {
    for (let y = start; y < height; y += step) rows.push(y);
  }
  return rows;
}

/**
 * The frames as the screen shows them: full width × height RGBA, straight
 * alpha, transparent where nothing was drawn. The same buffer is reused for
 * every frame, so copy it to keep it.
 */
export function* gifFrames(gif: GifInfo): Generator<{ rgba: Uint8ClampedArray; delayMs: number }> {
  const { width, height } = gif;
  const screen = new Uint8ClampedArray(width * height * 4);
  let saved: Uint8ClampedArray | null = null;
  for (const frame of gif.frames) {
    if (frame.disposal === 3) saved = screen.slice();
    const pixels = frame.width * frame.height;
    const indices = lzwDecode(frame.data, frame.minCodeSize, pixels);
    const rows = frame.interlaced ? interlacedRows(frame.height) : null;
    const colours = frame.palette.length / 3;
    for (let row = 0; row < frame.height; row += 1) {
      const y = frame.y + (rows ? (rows[row] ?? row) : row);
      if (y >= height) continue;
      for (let col = 0; col < frame.width; col += 1) {
        const x = frame.x + col;
        if (x >= width) continue;
        const index = indices[row * frame.width + col] ?? 0;
        if (index === frame.transparent || index >= colours) continue;
        const o = (y * width + x) * 4;
        screen[o] = frame.palette[index * 3] ?? 0;
        screen[o + 1] = frame.palette[index * 3 + 1] ?? 0;
        screen[o + 2] = frame.palette[index * 3 + 2] ?? 0;
        screen[o + 3] = 255;
      }
    }
    yield { rgba: screen, delayMs: frame.delayMs };
    if (frame.disposal === 2) {
      for (let y = frame.y; y < Math.min(height, frame.y + frame.height); y += 1) {
        const from = (y * width + frame.x) * 4;
        const to = (y * width + Math.min(width, frame.x + frame.width)) * 4;
        screen.fill(0, from, to);
      }
    } else if (frame.disposal === 3 && saved) {
      screen.set(saved);
    }
  }
}
