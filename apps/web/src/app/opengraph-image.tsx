import { ogImage, OG_SIZE } from '../lib/og';

export const dynamic = 'force-static';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'EditToolbelt: quick tools for video, photo and audio editors';

export default function Image() {
  return ogImage({
    label: 'The editor’s toolbelt',
    title: 'Quick tools for video, photo and audio editors',
    lead: 'Most run in your browser: no upload, no sign-up.',
    status: 'No tracking cookies',
  });
}
