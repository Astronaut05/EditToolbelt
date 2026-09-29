/**
 * Open Graph / Twitter card images, rendered at build time (docs/09 → Page
 * template): 1200 × 630, the dark Signal look, colours read from tokens.css so
 * they follow the design tokens. Static Onest and Plex Mono weights come from
 * Fontsource (the image renderer can't read WOFF2 or variable fonts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { parseTokens } from '@etb/ui/contrast';

export const OG_SIZE = { width: 1200, height: 630 };

const cwd = process.cwd();
const font = (path: string) => readFileSync(join(cwd, 'node_modules', path));
const dark = parseTokens(readFileSync(join(cwd, '../../packages/ui/tokens.css'), 'utf8')).dark;
const color = (name: string) => dark[name] ?? '#000000';

export function ogImage({
  label,
  title,
  lead,
  status,
}: {
  label: string;
  title: string;
  lead: string;
  status: string;
}) {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px 56px',
        background: color('bg'),
        color: color('text'),
        fontFamily: 'Onest',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontFamily: 'Plex Mono',
            fontSize: 22,
            letterSpacing: '0.14em',
            color: color('text-muted'),
          }}
        >
          {label.toUpperCase()}
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: title.length > 26 ? 84 : 104,
            fontWeight: 700,
            lineHeight: 0.98,
            letterSpacing: '-0.035em',
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 34,
            color: color('text-muted'),
            maxWidth: 960,
            lineHeight: 1.3,
          }}
        >
          {lead}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: `2px solid ${color('border-strong')}`,
          paddingTop: 28,
        }}
      >
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em' }}>
          Edit<span style={{ color: color('accent') }}>Toolbelt</span>
        </div>
        <div
          style={{
            fontFamily: 'Plex Mono',
            fontSize: 22,
            letterSpacing: '0.14em',
            color: color('text-muted'),
          }}
        >
          {status.toUpperCase()}
        </div>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        {
          name: 'Onest',
          data: font('@fontsource/onest/files/onest-latin-400-normal.woff'),
          weight: 400,
        },
        {
          name: 'Onest',
          data: font('@fontsource/onest/files/onest-latin-700-normal.woff'),
          weight: 700,
        },
        {
          name: 'Plex Mono',
          data: font('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff'),
          weight: 500,
        },
      ],
    },
  );
}
