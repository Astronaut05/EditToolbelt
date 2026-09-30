'use client';

import { estimateGifBytes, gifFrameCount, MEDIA_META } from '@etb/engines';
import {
  formatBytes,
  ToolShell,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.videoToGifEngine, MEDIA_META.videoToGif);

const OPTIONS: ShellOption[] = [
  { id: 'fps', label: 'Frame rate', kind: 'slider', min: 5, max: 30, unit: 'fps', default: '12' },
  {
    id: 'width',
    label: 'Width',
    kind: 'select',
    choices: [
      { value: '240', label: '240 px' },
      { value: '320', label: '320 px' },
      { value: '480', label: '480 px' },
      { value: '640', label: '640 px' },
      { value: '800', label: '800 px' },
      { value: 'original', label: 'Original, up to 1280 px' },
    ],
    default: '480',
  },
  {
    id: 'speed',
    label: 'Speed',
    choices: [
      { value: '0.5', label: '0.5×' },
      { value: '1', label: '1×' },
      { value: '1.5', label: '1.5×' },
      { value: '2', label: '2×' },
    ],
    default: '1',
  },
  {
    id: 'plays',
    label: 'Loop',
    choices: [
      { value: 'forever', label: 'Forever' },
      { value: 'once', label: 'Once' },
      { value: '3', label: '3 times' },
    ],
    default: 'forever',
  },
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'gif', label: 'GIF' },
      { value: 'webp', label: 'WebP' },
    ],
    default: 'gif',
  },
  {
    id: 'palette',
    label: 'Colors',
    choices: [
      { value: 'global', label: 'One palette' },
      { value: 'frame', label: 'Per frame' },
    ],
    default: 'global',
    when: { id: 'format', values: ['gif'] },
  },
  {
    id: 'dither',
    label: 'Dithering',
    choices: [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
    default: 'on',
    when: { id: 'format', values: ['gif'] },
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to make a GIF',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [
    ['fps', 'width'],
    ['speed', 'plays'],
    ['format', 'palette', 'dither'],
  ],
  probe: (file) => probeVideo(file),
  // A GIF starts as the first 5 s; the timeline changes it.
  initialRange: (duration) => ({ start: 0, end: Math.min(duration, 5) }),
  // tools/video.md → V04: the estimated size before export, and a warning above 15 MB.
  facts: (state, options, media, range) => {
    if (state.kind !== 'ready' || !media) return [];
    const frames = gifFrameCount(
      range.end - range.start,
      Number(options.fps) || 12,
      Number(options.speed) || 1,
    );
    const sw = media.width ?? 1280;
    const sh = media.height ?? 720;
    const width = Math.min(sw, Number(options.width) || Math.min(sw, 1280));
    const height = Math.round((sh * width) / sw);
    const bytes = estimateGifBytes(frames, width, height) * (options.format === 'webp' ? 0.35 : 1);
    return [
      {
        label: 'Estimate',
        value: `${String(frames)} frames · about ${formatBytes(bytes)}${bytes > 15 * 1024 * 1024 ? ' · over 15 MB' : ''}`,
      },
    ];
  },
  runLabel: 'Make GIF',
  outputExt: (options) => (options.format === 'webp' ? 'webp' : 'gif'),
  outputSuffix: '',
  resultTitle: 'GIF ready',
  result: 'output',
};

/** V04 Video to GIF (tools/video.md). */
export default function VideoToGif({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
