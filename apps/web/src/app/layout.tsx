import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SearchOverlay, themeScript } from '@etb/ui';

import { env } from '../lib/env';
import { absoluteUrl } from '../lib/urls';
import { fontVariables } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(absoluteUrl('/')),
  title: { default: 'EditToolbelt', template: '%s | EditToolbelt' },
  description:
    'Fast, no-install tools for video, photo and audio editors. Most run in your browser.',
  applicationName: 'EditToolbelt',
  other: { 'etb-version': env.APP_VERSION },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  // Mirrors --bg in tokens.css (meta tags can't read CSS variables).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0A0A' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Sets the stored theme before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <SearchOverlay />
      </body>
    </html>
  );
}
