import { notFound } from 'next/navigation';

import { conversions, getTool, toolPath, tools, toolsInCategory } from '@etb/registry';
import { buildSearchIndex } from '@etb/registry/search';
import type { ShellState } from '@etb/ui';

import { ComingSoon } from '../../../../components/ComingSoon';
import { HomeContent } from '../../../../components/HomeContent';
import { HubList } from '../../../../components/HubList';
import { SiteFrame } from '../../../../components/SiteFrame';
import { hubRows } from '../../../../lib/hub';
import { ToolScreen } from '../../../../workshop/ToolScreen';
import { Breadcrumb } from '@etb/ui';

// The screens of docs/design/screens/, rebuilt from real components with the
// fixture data they were drawn with (some tools live, a typed query, a run in
// progress). Workshop builds only (ETB_WORKSHOP=1).

const SCREENS = [
  'home',
  'hub-photo',
  'soon-upscale',
  'tool-empty',
  'tool-progress',
  'tool-result',
] as const;
type Screen = (typeof SCREENS)[number];

export const dynamicParams = false;
export function generateStaticParams() {
  return SCREENS.map((screen) => ({ screen }));
}

const live = (ids: string[]) =>
  tools.map((tool) => (ids.includes(tool.id) ? { ...tool, status: 'live' as const } : tool));

const input = { name: 'mug.jpg', size: 4_800_000, url: '/samples/mug.jpg' };
const STATES: Record<'tool-empty' | 'tool-progress' | 'tool-result', ShellState> = {
  'tool-empty': { kind: 'empty' },
  'tool-progress': {
    kind: 'running',
    input,
    fraction: 0.64,
    stage: 'Downloading the AI model, first time only',
    amount: '74 / 115 MB',
    step: 'Step 1 of 2 · then finding the subject',
    elapsedSec: 3.8,
  },
  'tool-result': {
    kind: 'result',
    input,
    output: {
      size: 3_100_000,
      ext: 'png',
      url: '/samples/mug-cutout.png',
      seconds: 1.9,
      path: 'WebGPU',
      width: 3024,
      height: 4032,
    },
  },
};

function HubScreen() {
  const liveIds = [
    'remove-background',
    'resize-image',
    'crop-image',
    'compress-image',
    'image-converter',
  ];
  const order = [
    ...liveIds,
    'rotate-image',
    'upscale-image',
    'photo-editor',
    'add-text-to-image',
    'watermark-image',
  ];
  const rows = hubRows(live(liveIds).filter((tool) => order.includes(tool.id))).sort(
    (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
  );
  return (
    <SiteFrame current="photo">
      <div className="px-4 pt-5.5 lg:px-10 lg:pt-8.5">
        <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Photo' }]} />
        <h1 className="mt-3 text-46 leading-display-xl font-display tracking-display-xl lg:mt-4.5 lg:text-72">
          Photo tools
        </h1>
        <HubList
          rows={rows}
          lead="Crop, resize, convert and clean up images. Most tools run in your browser, so your photos never leave your device."
          counts={{ all: toolsInCategory('photo').length, browser: 17, ai: 3 }}
        />
      </div>
    </SiteFrame>
  );
}

export default async function ScreenPage({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = (await params) as { screen: Screen };
  switch (screen) {
    case 'home':
      return (
        <SiteFrame>
          <HomeContent
            initialQuery="mp4 to gif"
            index={buildSearchIndex(live(['video-to-gif', 'gif-to-mp4']), conversions)}
          />
        </SiteFrame>
      );
    case 'hub-photo':
      return <HubScreen />;
    case 'soon-upscale': {
      const tool = getTool('upscale-image');
      return (
        <SiteFrame current="photo">
          <ComingSoon
            category={{ name: 'Photo', href: '/photo' }}
            name={tool.name}
            h1={tool.seo.h1}
            tagline={tool.tagline}
            willDo={tool.willDo}
            panelLabel="Until then, try"
            tryLinks={['resize-image', 'compress-image', 'remove-background'].map((id) => {
              const related = getTool(id);
              return { href: toolPath(related), name: related.name, summary: related.summary };
            })}
          />
        </SiteFrame>
      );
    }
    case 'tool-empty':
    case 'tool-progress':
    case 'tool-result':
      return (
        <SiteFrame current="photo" footer={false}>
          <ToolScreen state={STATES[screen]} />
        </SiteFrame>
      );
    default:
      notFound();
  }
}
