'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.framesEngine, MEDIA_META.frames);

const OPTIONS: ShellOption[] = [
  {
    id: 'mode',
    label: 'Take',
    kind: 'select',
    choices: [
      { value: 'single', label: 'One frame, at the In point' },
      { value: 'interval', label: 'A frame every few seconds' },
      { value: 'count', label: 'A number of frames, evenly spaced' },
      { value: 'sheet', label: 'A contact sheet' },
    ],
    default: 'single',
  },
  {
    id: 'every',
    label: 'Every',
    kind: 'number',
    unit: 's',
    min: 0.1,
    step: 0.1,
    default: '5',
    when: { id: 'mode', values: ['interval'] },
  },
  {
    id: 'count',
    label: 'Frames',
    kind: 'number',
    min: 1,
    max: 500,
    default: '10',
    when: { id: 'mode', values: ['count'] },
  },
  {
    id: 'grid',
    label: 'Grid',
    choices: [
      { value: '3x3', label: '3 × 3' },
      { value: '4x4', label: '4 × 4' },
      { value: '5x5', label: '5 × 5' },
      { value: '4x6', label: '4 × 6' },
    ],
    default: '4x4',
    when: { id: 'mode', values: ['sheet'] },
  },
  {
    id: 'size',
    label: 'Width',
    choices: [
      { value: 'original', label: 'Original' },
      { value: '1920', label: '1920 px' },
      { value: '1280', label: '1280 px' },
      { value: '640', label: '640 px' },
    ],
    default: 'original',
    when: { id: 'mode', values: ['single', 'interval', 'count'] },
  },
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'png', label: 'PNG' },
      { value: 'jpeg', label: 'JPG' },
      { value: 'webp', label: 'WebP' },
    ],
    default: 'png',
  },
];

const EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to take frames from',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [
    ['mode', 'every', 'count', 'grid'],
    ['size', 'format'],
  ],
  probe: (file) => probeVideo(file),
  facts: (_state, options) => [
    {
      label: 'From',
      value:
        options.mode === 'single'
          ? 'The frame on screen at the In point: drag it, or type the time'
          : 'The selection between In and Out',
    },
  ],
  runLabel: 'Extract frames',
  outputExt: (options) =>
    options.mode === 'interval' || options.mode === 'count'
      ? 'zip'
      : (EXT[options.format ?? 'png'] ?? 'png'),
  outputSuffix: 'frames',
  resultTitle: 'Frames',
};

/** V10 Extract Frames / Thumbnail (tools/video.md). The timeline sets the time or the stretch. */
export default function ExtractFrames({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
