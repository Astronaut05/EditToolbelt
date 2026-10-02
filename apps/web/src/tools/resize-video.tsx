'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.reframeEngine, MEDIA_META.reframe);

const FILL = { id: 'fit', values: ['fill'] };

const OPTIONS: ShellOption[] = [
  {
    id: 'size',
    label: 'Size',
    kind: 'select',
    choices: [
      { value: '1080x1920', label: 'Reels, TikTok, Shorts · 1080 × 1920' },
      { value: '1080x1350', label: 'Instagram portrait · 1080 × 1350' },
      { value: '1080x1080', label: 'Square · 1080 × 1080' },
      { value: '1920x1080', label: 'YouTube · 1920 × 1080' },
      { value: 'custom', label: 'Custom' },
    ],
    default: '1080x1920',
  },
  {
    id: 'width',
    label: 'Width',
    kind: 'number',
    unit: 'px',
    min: 2,
    max: 4096,
    default: '1280',
    when: { id: 'size', values: ['custom'] },
  },
  {
    id: 'height',
    label: 'Height',
    kind: 'number',
    unit: 'px',
    min: 2,
    max: 4096,
    default: '720',
    when: { id: 'size', values: ['custom'] },
  },
  {
    id: 'fit',
    label: 'Fit',
    choices: [
      { value: 'fill', label: 'Fill, crop' },
      { value: 'blur', label: 'Fit on blur' },
      { value: 'color', label: 'Fit on color' },
    ],
    default: 'fill',
  },
  {
    id: 'x',
    label: 'Framing across',
    kind: 'slider',
    min: 0,
    max: 100,
    unit: '%',
    default: '50',
    when: FILL,
  },
  {
    id: 'y',
    label: 'Framing down',
    kind: 'slider',
    min: 0,
    max: 100,
    unit: '%',
    default: '50',
    when: FILL,
  },
  {
    id: 'color',
    label: 'Color',
    kind: 'color',
    default: '#000000',
    when: { id: 'fit', values: ['color'] },
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to resize for social media',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [
    ['size', 'width', 'height'],
    ['fit', 'x', 'y', 'color'],
  ],
  probe: (file) => probeVideo(file),
  facts: (_state, options) => [
    {
      label: 'Framing',
      value:
        options.fit === 'fill'
          ? '0% keeps the left or top edge, 100% the right or bottom, 50% the middle'
          : 'The whole picture, with the space around it filled',
    },
  ],
  runLabel: 'Resize video',
  // The file keeps its own format; the engine reports it.
  outputExt: () => '',
  outputSuffix: 'resized',
  resultTitle: 'Resized',
};

/** V09 Resize & Crop Video for Social (tools/video.md). */
export default function ResizeVideo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
