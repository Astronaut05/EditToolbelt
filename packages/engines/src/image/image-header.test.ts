import { describe, expect, it } from 'vitest';

import { checkDecoded, imageHeader } from './image-header';

/** A PNG's signature and IHDR, saying `width` × `height`: nothing to decode, which is the point. */
function png(width: number, height: number): Blob {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return new Blob([bytes]);
}

/** A JPEG head: `padding` bytes of APP segments (metadata), an EXIF orientation, then its frame header. */
function jpeg(width: number, height: number, orientation = 1, padding = 0): Blob {
  const parts: number[] = [0xff, 0xd8];
  for (let left = padding; left > 0; left -= 65_533) {
    const size = Math.min(65_533, left);
    parts.push(0xff, 0xed, ((size + 2) >> 8) & 0xff, (size + 2) & 0xff, ...new Uint8Array(size));
  }
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0, 0, 0, 0, 0, 0];
  parts.push(0xff, 0xe1, 0, exif.length + 2, ...exif);
  parts.push(0xff, 0xc0, 0, 17, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3);
  parts.push(1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9);
  return new Blob([Uint8Array.from(parts)]);
}

describe('imageHeader', () => {
  it('reads the size without decoding, upright', async () => {
    expect(await imageHeader(png(640, 480))).toEqual({ format: 'png', width: 640, height: 480 });
    // A phone photo stored on its side (orientation 6) stands 3000 × 4000.
    expect(await imageHeader(jpeg(4000, 3000, 6))).toEqual({
      format: 'jpeg',
      width: 3000,
      height: 4000,
    });
  });

  it('reads on past metadata longer than the first half megabyte', async () => {
    expect(await imageHeader(jpeg(1200, 800, 1, 700_000))).toMatchObject({
      width: 1200,
      height: 800,
    });
  });

  it('refuses an image over 100 MP from its header, naming it when asked', async () => {
    await expect(imageHeader(png(20_000, 20_000))).rejects.toThrow(
      'This image is 20000 × 20000 px (400 MP); the browser limit is 100 MP.',
    );
    await expect(imageHeader(png(20_000, 20_000), 'huge.png')).rejects.toThrow(
      'huge.png is 20000 × 20000 px (400 MP); the browser limit is 100 MP.',
    );
    await expect(imageHeader(new Blob(['not an image']), 'notes.txt')).rejects.toThrow(
      /^notes\.txt: This isn’t an image/,
    );
  });

  it('gives no size for a format whose header doesn’t say it', async () => {
    const avif = new Uint8Array(32);
    avif.set([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
    expect(await imageHeader(new Blob([avif]))).toEqual({
      format: 'avif',
      width: null,
      height: null,
    });
  });
});

describe('checkDecoded', () => {
  it('stops a decoded image over 100 MP', () => {
    expect(() => {
      checkDecoded(10_000, 10_000, 'a.avif');
    }).not.toThrow();
    expect(() => {
      checkDecoded(12_000, 9_000, 'a.avif');
    }).toThrow('a.avif is 12000 × 9000 px (108 MP); the browser limit is 100 MP.');
  });
});
