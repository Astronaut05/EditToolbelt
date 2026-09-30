/**
 * Animated WebP for V04's WebP option: each frame is encoded on its own
 * (libwebp through jSquash), then its image chunks go into ANMF frames behind
 * a VP8X header and an ANIM loop block (the WebP container spec).
 */

const fourcc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/** The ALPH, VP8 and VP8L chunks of a single-image WebP, padding included. */
export function imageChunks(webp: Uint8Array): Uint8Array {
  const text = (at: number) => String.fromCharCode(...webp.subarray(at, at + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WEBP') throw new Error('Not a WebP file');
  const parts: Uint8Array[] = [];
  let at = 12;
  while (at + 8 <= webp.length) {
    const id = text(at);
    const size =
      (webp[at + 4] ?? 0) |
      ((webp[at + 5] ?? 0) << 8) |
      ((webp[at + 6] ?? 0) << 16) |
      ((webp[at + 7] ?? 0) << 24);
    const end = at + 8 + size + (size & 1);
    if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') parts.push(webp.subarray(at, end));
    at = end;
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export interface WebpFrame {
  /** A complete single-image WebP. */
  webp: Uint8Array;
  durationMs: number;
}

/** Joins frames into an animated WebP; loops 0 is forever. */
export function muxAnimatedWebp(
  frames: WebpFrame[],
  width: number,
  height: number,
  loops: number,
  alpha: boolean,
): Uint8Array<ArrayBuffer> {
  const chunks: number[][] = [];
  // VP8X: animation (and alpha) flags, canvas size minus one.
  chunks.push([
    ...fourcc('VP8X'),
    ...u32(10),
    0x02 | (alpha ? 0x10 : 0),
    0,
    0,
    0,
    ...u24(width - 1),
    ...u24(height - 1),
  ]);
  // ANIM: background colour (transparent), loop count.
  chunks.push([...fourcc('ANIM'), ...u32(6), 0, 0, 0, 0, loops & 0xff, (loops >> 8) & 0xff]);
  const bodies: Uint8Array[] = [];
  for (const frame of frames) {
    const image = imageChunks(frame.webp);
    const size = 16 + image.length;
    const header = [
      ...fourcc('ANMF'),
      ...u32(size),
      ...u24(0),
      ...u24(0),
      ...u24(width - 1),
      ...u24(height - 1),
      ...u24(Math.max(1, Math.round(frame.durationMs))),
      // No blending, no disposal: each frame replaces the canvas.
      0x02,
    ];
    const body = new Uint8Array(header.length + image.length + (size & 1));
    body.set(header);
    body.set(image, header.length);
    bodies.push(body);
  }
  const head = chunks.flat();
  const total = 4 + head.length + bodies.reduce((sum, body) => sum + body.length, 0);
  const out = new Uint8Array(8 + total);
  out.set([...fourcc('RIFF'), ...u32(total), ...fourcc('WEBP')]);
  out.set(head, 12);
  let at = 12 + head.length;
  for (const body of bodies) {
    out.set(body, at);
    at += body.length;
  }
  return out;
}
