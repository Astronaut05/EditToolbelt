/**
 * Wraps a PNG in an .ico container (one image, PNG-compressed, which every
 * current browser reads). Browsers ask for /favicon.ico on their own, even
 * with <link rel="icon">, and a 404 there is a console error on every page.
 */
export function pngToIco(png: Buffer, size: number): Buffer {
  if (size < 1 || size > 256) throw new Error('ico images are 1-256 px');
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(size === 256 ? 0 : size, 6); // width (0 means 256)
  header.writeUInt8(size === 256 ? 0 : size, 7); // height
  header.writeUInt8(0, 8); // no palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14); // image size
  header.writeUInt32LE(22, 18); // image offset
  return Buffer.concat([header, png]);
}
