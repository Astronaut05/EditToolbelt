import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { env } from '../lib/env';
import { absoluteUrl } from '../lib/urls';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(absoluteUrl('/')),
  title: 'EditToolbelt',
  description: 'The editor’s toolbelt: fast, no-install tools for video, photo and audio editors.',
  // Placeholder: keep it out of search results (tool pages get real metadata in M1).
  robots: { index: false, follow: false },
  other: { 'etb-version': env.APP_VERSION },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
