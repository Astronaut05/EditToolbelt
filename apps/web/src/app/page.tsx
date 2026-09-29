import type { Metadata } from 'next';

import { HomeContent } from '../components/HomeContent';
import { SiteFrame } from '../components/SiteFrame';
import { JsonLd, pageMetadata, websiteJsonLd } from '../lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'EditToolbelt: Quick Tools for Video, Photo and Audio Editors',
  description:
    'Fast, no-install tools for editors: trim, compress, convert, remove backgrounds, find BPM. Most run in your browser, so files never leave your device.',
  path: '/',
});

export default function HomePage() {
  return (
    <SiteFrame>
      <JsonLd data={websiteJsonLd()} />
      <HomeContent />
    </SiteFrame>
  );
}
