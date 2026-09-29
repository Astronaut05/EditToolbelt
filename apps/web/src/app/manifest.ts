import type { MetadataRoute } from 'next';

import { SITE_NAME } from '../lib/seo';

export const dynamic = 'force-static';

// Installable web app (docs/12 → M1: PWA manifest). Colours mirror --bg dark.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME}: tools for video, photo and audio editors`,
    short_name: SITE_NAME,
    description: 'Fast, no-install tools for editors. Most run in your browser.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0A0A0A',
    theme_color: '#0A0A0A',
    categories: ['photo', 'productivity', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
