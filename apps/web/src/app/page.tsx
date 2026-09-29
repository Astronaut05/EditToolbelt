import type { Metadata } from 'next';

import { HomeContent } from '../components/HomeContent';
import { SiteFrame } from '../components/SiteFrame';

export const metadata: Metadata = {
  title: { absolute: 'EditToolbelt: Quick Tools for Video, Photo and Audio Editors' },
  description:
    'Fast, no-install tools for editors: trim, compress, convert, remove backgrounds, find BPM. Most run in your browser, so files never leave your device.',
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return (
    <SiteFrame>
      <HomeContent />
    </SiteFrame>
  );
}
