/**
 * BMP writer: 24-bit when every pixel is opaque, else 32-bit with an alpha
 * mask (BITMAPV4HEADER), which Windows, macOS and browsers all read.
 */
export function encodeBmp(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const bytesPerPixel = opaque ? 3 : 4;
  const stride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const headerSize = opaque ? 40 : 108;
  const offset = 14 + headerSize;
  const out = new Uint8Array(offset + stride * height);
  const view = new DataView(out.buffer);
  out.set([0x42, 0x4d]); // "BM"
  view.setUint32(2, out.length, true);
  view.setUint32(10, offset, true);
  view.setUint32(14, headerSize, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive: rows bottom-up
  view.setUint16(26, 1, true);
  view.setUint16(28, bytesPerPixel * 8, true);
  view.setUint32(30, opaque ? 0 : 3, true); // BI_RGB or BI_BITFIELDS
  view.setUint32(34, stride * height, true);
  view.setInt32(38, 2835, true); // 72 dpi
  view.setInt32(42, 2835, true);
  if (!opaque) {
    view.setUint32(54, 0x00ff0000, true); // red mask
    view.setUint32(58, 0x0000ff00, true);
    view.setUint32(62, 0x000000ff, true);
    view.setUint32(66, 0xff000000, true); // alpha mask
    view.setUint32(70, 0x73524742, true); // "sRGB"
  }
  for (let y = 0; y < height; y += 1) {
    const row = offset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = row + x * bytesPerPixel;
      out[to] = rgba[from + 2] ?? 0;
      out[to + 1] = rgba[from + 1] ?? 0;
      out[to + 2] = rgba[from] ?? 0;
      if (!opaque) out[to + 3] = rgba[from + 3] ?? 0;
    }
  }
  return out;
}
