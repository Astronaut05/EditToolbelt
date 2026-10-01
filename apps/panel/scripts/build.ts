/**
 * Builds the Premiere panel (docs/01 → Premiere panel) into dist/: the bundle,
 * its page and styles, the UXP manifest and the icons. With --ccx it also
 * zips dist/ into a .ccx, the package Adobe's tools install and Exchange takes.
 *
 * No host in code (docs/01 → Hosting): the API's address comes from SITE_URL
 * and the storage's (where uploads and results go) from STORAGE_URL; UXP only
 * lets a plugin reach the domains its manifest lists, so both go in there.
 *
 *   SITE_URL=http://localhost:3000 STORAGE_URL=http://localhost:7070 pnpm --filter @etb/panel build
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { build } from 'esbuild';
import { zipSync } from 'fflate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

function origin(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${name} must be an absolute URL, got "${value}"`);
  }
}

const SITE = origin('SITE_URL', 'http://localhost:3000');
const STORAGE = origin('STORAGE_URL', 'http://localhost:7070');
/** Adobe gives a plugin its ID when it's registered for Exchange; this is the local one until then. */
const PLUGIN_ID = process.env.PANEL_PLUGIN_ID ?? 'edittoolbelt-panel';

// ── Icons: the site's mark (a dark tile, a light E, a lime bar), drawn here as PNGs ──

/** The mark in its own 32 × 32 units: rectangles, and the tile's corner radius. */
const MARK = {
  tile: { colour: [10, 10, 10] as const, radius: 4 },
  rects: [
    // The E.
    { x: 8, y: 7, w: 4, h: 19, colour: [242, 242, 242] as const },
    { x: 8, y: 7, w: 12, h: 3.5, colour: [242, 242, 242] as const },
    { x: 12, y: 14.25, w: 7, h: 3.5, colour: [242, 242, 242] as const },
    { x: 12, y: 22.5, w: 8, h: 3.5, colour: [242, 242, 242] as const },
    // The bar.
    { x: 22.5, y: 7, w: 3.5, h: 19, colour: [185, 224, 76] as const },
  ],
};

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** The mark at `size` px, 4 × 4 samples a pixel, as an RGBA PNG. */
export function markPng(size: number): Buffer {
  const scale = 32 / size;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const inTile = (x: number, y: number) => {
    const r = MARK.tile.radius;
    const cx = Math.min(Math.max(x, r), 32 - r);
    const cy = Math.min(Math.max(y, r), 32 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let py = 0; py < size; py += 1) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px += 1) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let s = 0; s < 16; s += 1) {
        const x = (px + ((s % 4) + 0.5) / 4) * scale;
        const y = (py + (Math.floor(s / 4) + 0.5) / 4) * scale;
        if (!inTile(x, y)) continue;
        const hit = MARK.rects.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
        const colour = hit ? hit.colour : MARK.tile.colour;
        r += colour[0];
        g += colour[1];
        b += colour[2];
        a += 1;
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / 16) * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

// ── The manifest (UXP manifest v5) ──

export function manifest(): Record<string, unknown> {
  return {
    manifestVersion: 5,
    id: PLUGIN_ID,
    name: 'EditToolbelt',
    version: pkg.version,
    main: 'index.html',
    // Premiere 2026: the first release where UXP is a standard feature (docs/01).
    host: { app: 'premierepro', minVersion: '26.0.0' },
    entrypoints: [
      {
        type: 'panel',
        id: 'main',
        label: { default: 'EditToolbelt' },
        minimumSize: { width: 240, height: 320 },
        maximumSize: { width: 2000, height: 4000 },
        preferredDockedSize: { width: 320, height: 600 },
        preferredFloatingSize: { width: 360, height: 640 },
        icons: [{ width: 23, height: 23, path: 'icons/panel.png', scale: [1, 2], theme: ['all'] }],
      },
    ],
    requiredPermissions: {
      network: { domains: [SITE, STORAGE] },
      // "Connect" and "Buy credits" open the website in the browser.
      launchProcess: { schemes: [new URL(SITE).protocol.replace(':', '')], extensions: [] },
      // Reading the selected clip's media file by its path needs full access.
      localFileSystem: 'fullAccess',
    },
    icons: [{ width: 48, height: 48, path: 'icons/plugin.png', scale: [1, 2], theme: ['all'] }],
  };
}

async function main() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, 'icons'), { recursive: true });
  await build({
    entryPoints: [join(ROOT, 'src/main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    // UXP's JavaScript engine is a recent V8.
    target: 'es2022',
    minify: true,
    legalComments: 'external',
    outfile: join(DIST, 'main.js'),
    define: {
      __SITE_URL__: JSON.stringify(SITE),
      __PANEL_VERSION__: JSON.stringify(pkg.version),
    },
    logLevel: 'warning',
  });
  copyFileSync(join(ROOT, 'src/index.html'), join(DIST, 'index.html'));
  copyFileSync(join(ROOT, 'src/styles.css'), join(DIST, 'styles.css'));
  writeFileSync(join(DIST, 'icons/panel@1x.png'), markPng(23));
  writeFileSync(join(DIST, 'icons/panel@2x.png'), markPng(46));
  writeFileSync(join(DIST, 'icons/plugin@1x.png'), markPng(48));
  writeFileSync(join(DIST, 'icons/plugin@2x.png'), markPng(96));
  writeFileSync(join(DIST, 'manifest.json'), `${JSON.stringify(manifest(), null, 2)}\n`);

  if (process.argv.includes('--ccx')) {
    const files: Record<string, Uint8Array> = {};
    const add = (path: string) => {
      files[relative(DIST, path).replaceAll('\\', '/')] = readFileSync(path);
    };
    for (const name of ['index.html', 'styles.css', 'main.js', 'manifest.json']) {
      add(join(DIST, name));
    }
    for (const name of ['panel@1x.png', 'panel@2x.png', 'plugin@1x.png', 'plugin@2x.png']) {
      add(join(DIST, 'icons', name));
    }
    const legal = join(DIST, 'main.js.LEGAL.txt');
    try {
      add(legal);
    } catch {
      // No third-party licence comments in the bundle.
    }
    const ccx = join(ROOT, `edittoolbelt-panel-${pkg.version}.ccx`);
    writeFileSync(ccx, zipSync(files, { level: 9 }));
    console.log(`Wrote ${relative(process.cwd(), ccx)}`);
  }
  console.log(
    `Built the panel for ${SITE} (storage ${STORAGE}) into ${relative(process.cwd(), DIST)}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
