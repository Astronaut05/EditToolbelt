import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { StoredZip, ZipTooLargeError } from './zip';

const text = (s: string) => new TextEncoder().encode(s);

describe('StoredZip', () => {
  it('writes a ZIP any unzip reads, each file stored as it was', async () => {
    const zip = new StoredZip();
    zip.add('a.png', text('first'));
    zip.add('b.png', text('second, a little longer'));
    zip.add('c.txt', new Uint8Array(0));
    const blob = zip.finish();
    expect(blob.type).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files)).toEqual(['a.png', 'b.png', 'c.txt']);
    expect(new TextDecoder().decode(files['b.png'])).toBe('second, a little longer');
    expect(files['c.txt']).toHaveLength(0);
    expect(zip.files).toBe(3);
    expect(zip.bytes).toBe(28);
  });

  it('keeps a file whose name is taken, under a new name', async () => {
    const zip = new StoredZip();
    zip.add('frame.png', text('1'));
    zip.add('frame.png', text('2'));
    zip.add('frame', text('3'));
    zip.add('frame', text('4'));
    const files = unzipSync(new Uint8Array(await zip.finish().arrayBuffer()));
    expect(Object.keys(files)).toEqual(['frame.png', 'frame-2.png', 'frame', 'frame-2']);
  });

  it('refuses a file past its size limit, and says what still fits', () => {
    const zip = new StoredZip(10);
    zip.add('a', text('12345678'));
    expect(zip.fits(2)).toBe(true);
    expect(zip.fits(3)).toBe(false);
    expect(() => {
      zip.add('b', text('123'));
    }).toThrow(ZipTooLargeError);
  });
});
