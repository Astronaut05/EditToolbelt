import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import { payload, type QrContent } from './content';
import { qrMatrix, qrPaths, qrSvg, scanWarning, type EcLevel, type QrMatrix } from './qr';

/** Draws the matrix as black-on-white pixels, with an optional blank logo box, and decodes it. */
function decode(matrix: QrMatrix, logoShare = 0): string | null {
  const scale = 4;
  const margin = 4;
  const px = (matrix.size + 2 * margin) * scale;
  const pixels = new Uint8ClampedArray(px * px * 4).fill(255);
  const logo = qrPaths(matrix, { margin, dots: 'square', eyes: 'square', logo: logoShare }).logo;
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      const covered =
        logo !== null &&
        x + margin >= logo.x &&
        x + margin < logo.x + logo.size &&
        y + margin >= logo.y &&
        y + margin < logo.y + logo.size;
      if (!matrix.dark[y * matrix.size + x] || covered) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const i = (((y + margin) * scale + dy) * px + (x + margin) * scale + dx) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(pixels, px, px)?.data ?? null;
}

function build(content: QrContent): string {
  const result = payload(content);
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

const CONTENTS = [
  { type: 'url', url: 'example.com/menu?table=4' },
  { type: 'text', text: 'Oʻzbekiston: қ ғ ҳ ў, and an emoji 🎬' },
  { type: 'wifi', ssid: 'Studio; 5G', password: 'p@ss:w,rd"\\', security: 'WPA', hidden: true },
  { type: 'wifi', ssid: 'Guest', password: '', security: 'nopass', hidden: false },
  {
    type: 'vcard',
    firstName: 'Ada',
    lastName: 'Lovelace',
    org: 'Analytical, Ltd',
    title: 'Editor',
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
    website: 'example.com',
  },
  {
    type: 'email',
    to: 'hello@example.com',
    subject: 'Cut 3 notes',
    body: 'See 01:02:03;04 & more',
  },
  { type: 'phone', number: '+1 (555) 010-0199' },
  { type: 'sms', number: '+998 90 123 45 67', message: 'Render done' },
] as const satisfies QrContent[];

describe('QR codes decode to exactly what went in (tools/utility.md → U01 tests)', () => {
  for (const content of CONTENTS) {
    for (const ec of ['L', 'M', 'Q', 'H'] as EcLevel[]) {
      it(`${content.type} at ${ec}`, () => {
        const text = build(content);
        const result = qrMatrix(text, ec);
        if (!result.ok) throw new Error(result.error);
        expect(decode(result.matrix)).toBe(text);
      });
    }
  }

  it('still decodes with a centre logo at level H', () => {
    for (const content of CONTENTS) {
      const text = build(content);
      const result = qrMatrix(text, 'H');
      if (!result.ok) throw new Error(result.error);
      expect(decode(result.matrix, 0.22), content.type).toBe(text);
    }
  });

  it('reports text that does not fit', () => {
    expect(qrMatrix('x'.repeat(3000), 'H')).toMatchObject({ ok: false });
    expect(qrMatrix('x'.repeat(2900), 'L')).toMatchObject({ ok: true });
  });
});

describe('payloads', () => {
  it('builds the formats phone cameras read', () => {
    expect(build(CONTENTS[0])).toBe('https://example.com/menu?table=4');
    expect(build(CONTENTS[2])).toBe(
      String.raw`WIFI:T:WPA;S:Studio\; 5G;P:p@ss\:w\,rd\"\\;H:true;;`,
    );
    expect(build(CONTENTS[3])).toBe('WIFI:T:nopass;S:Guest;;');
    expect(build(CONTENTS[4]).split('\r\n')).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Lovelace;Ada;;;',
      'FN:Ada Lovelace',
      'ORG:Analytical\\, Ltd',
      'TITLE:Editor',
      'TEL;TYPE=CELL:+442079460958',
      'EMAIL:ada@example.com',
      'URL:https://example.com',
      'END:VCARD',
    ]);
    expect(build(CONTENTS[5])).toBe(
      'mailto:hello@example.com?subject=Cut%203%20notes&body=See%2001%3A02%3A03%3B04%20%26%20more',
    );
    expect(build(CONTENTS[6])).toBe('tel:+15550100199');
    expect(build(CONTENTS[7])).toBe('SMSTO:+998901234567:Render done');
  });

  it('says what is missing', () => {
    expect(payload({ type: 'url', url: ' ' })).toMatchObject({ ok: false });
    expect(
      payload({ type: 'wifi', ssid: 'x', password: '', security: 'WPA', hidden: false }),
    ).toMatchObject({
      ok: false,
    });
    expect(payload({ type: 'email', to: 'nope', subject: '', body: '' })).toMatchObject({
      ok: false,
    });
  });
});

describe('drawing', () => {
  const result = qrMatrix('https://example.com', 'M');
  if (!result.ok) throw new Error(result.error);
  const { matrix } = result;

  it('square dots cover every dark module outside the eyes', () => {
    const paths = qrPaths(matrix, { margin: 4, dots: 'square', eyes: 'square', logo: 0 });
    const covered = [...paths.dots.matchAll(/h(\d+)v1/g)].reduce(
      (sum, match) => sum + Number(match[1]),
      0,
    );
    const finder = 3 * (49 - 16 - 9 + 9); // ring 24 + centre 9 per eye
    expect(covered + finder).toBe(matrix.dark.filter(Boolean).length);
    expect(paths.extent).toBe(matrix.size + 8);
  });

  it('writes a clean SVG: no scripts, no external references', () => {
    const paths = qrPaths(matrix, { margin: 4, dots: 'rounded', eyes: 'rounded', logo: 0.22 });
    const svg = qrSvg(paths, {
      px: 1024,
      fg: '#111111',
      bg: '#ffffff',
      logoHref: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1024"/);
    expect(svg).not.toMatch(/<script|on\w+=|href="(?!data:image\/png)/i);
    expect(() => qrSvg(paths, { px: 1, fg: 'red"/><script>', bg: '#ffffff' })).toThrow();
    expect(() =>
      qrSvg(paths, {
        px: 1,
        fg: '#000000',
        bg: '#ffffff',
        logoHref: 'data:image/svg+xml;base64,PHN2Zz4=',
      }),
    ).toThrow();
  });

  it('warns when colours may not scan', () => {
    expect(scanWarning('#000000', '#ffffff')).toBeNull();
    expect(scanWarning('#777777', '#888888')).toMatch(/Contrast/);
    expect(scanWarning('#ffffff', '#000000')).toMatch(/inverted/);
  });
});
