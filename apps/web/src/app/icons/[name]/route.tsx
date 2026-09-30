import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { parseTokens } from '@etb/ui/contrast';

// PWA and home-screen icons, drawn at build from the dark tokens. Placeholder
// monogram until open question 1 settles the logo (same as app/icon.svg).
export const dynamic = 'force-static';

const ICONS: Record<string, { size: number; maskable: boolean }> = {
  // Wrapped into /favicon.ico by scripts/postbuild.ts.
  'favicon-32.png': { size: 32, maskable: false },
  'icon-192.png': { size: 192, maskable: false },
  'icon-512.png': { size: 512, maskable: false },
  'maskable-512.png': { size: 512, maskable: true },
  'apple-touch-icon.png': { size: 180, maskable: true },
};

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

const dark = parseTokens(
  readFileSync(join(process.cwd(), '../../packages/ui/tokens.css'), 'utf8'),
).dark;

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const icon = ICONS[name];
  if (!icon) return new Response('Not found', { status: 404 });
  const { size, maskable } = icon;
  // Maskable icons keep the mark inside the central 80 % safe zone.
  const unit = (size * (maskable ? 0.6 : 0.75)) / 19;
  const bar = (width: number, height: number, color: string) => (
    <div style={{ width: width * unit, height: height * unit, background: color }} />
  );
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: dark.bg,
        borderRadius: maskable ? 0 : size * 0.125,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 2.5 * unit, height: 19 * unit }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          {bar(12, 3.5, dark.text ?? '#FFFFFF')}
          {bar(11, 3.5, dark.text ?? '#FFFFFF')}
          {bar(12, 3.5, dark.text ?? '#FFFFFF')}
        </div>
        {bar(3.5, 19, dark.accent ?? '#FFFFFF')}
      </div>
    </div>,
    { width: size, height: size },
  );
}
