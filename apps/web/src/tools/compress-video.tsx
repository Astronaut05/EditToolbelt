'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.compressEngine, MEDIA_META.compress);

const OPTIONS: ShellOption[] = [
  {
    id: 'mode',
    label: 'Compress to',
    choices: [
      { value: 'target', label: 'A size' },
      { value: 'quality', label: 'A quality' },
    ],
    default: 'target',
  },
  {
    id: 'target',
    label: 'Size',
    kind: 'select',
    choices: [
      { value: '8', label: '8 MB' },
      { value: '10', label: '10 MB · Discord' },
      { value: '16', label: '16 MB · WhatsApp' },
      { value: '25', label: '25 MB · Email' },
      { value: '50', label: '50 MB' },
      { value: '100', label: '100 MB' },
      { value: 'custom', label: 'Custom' },
    ],
    default: '25',
    when: { id: 'mode', values: ['target'] },
  },
  {
    id: 'targetMb',
    label: 'Custom size',
    kind: 'number',
    unit: 'MB',
    min: 1,
    default: '20',
    when: { id: 'target', values: ['custom'] },
  },
  {
    id: 'quality',
    label: 'Quality',
    choices: [
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Medium' },
      { value: 'small', label: 'Small' },
    ],
    default: 'medium',
    when: { id: 'mode', values: ['quality'] },
  },
  {
    id: 'resolution',
    label: 'Resolution',
    kind: 'select',
    choices: [
      { value: 'auto', label: 'Auto' },
      { value: 'keep', label: 'Keep' },
      { value: '1080', label: '1080p' },
      { value: '720', label: '720p' },
      { value: '480', label: '480p' },
      { value: '360', label: '360p' },
    ],
    default: 'auto',
  },
  {
    id: 'fps',
    label: 'Frame rate',
    kind: 'select',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: '30', label: '30 fps' },
      { value: '24', label: '24 fps' },
      { value: '15', label: '15 fps' },
    ],
    default: 'keep',
  },
  {
    id: 'codec',
    label: 'Codec',
    kind: 'select',
    choices: [
      { value: 'avc', label: 'H.264 · plays everywhere' },
      { value: 'hevc', label: 'H.265 · smaller' },
      { value: 'av1', label: 'AV1 · smallest' },
      { value: 'vp9', label: 'VP9 · WebM' },
    ],
    default: 'avc',
  },
  {
    id: 'audio',
    label: 'Audio',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'remove', label: 'Remove' },
    ],
    default: 'keep',
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to compress',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [
    ['mode', 'target', 'targetMb', 'quality'],
    ['resolution', 'fps'],
    ['codec', 'audio'],
  ],
  probe: (file) => probeVideo(file),
  // The spec's "estimated output before start": a target is the estimate.
  facts: (state, options) => {
    if (state.kind !== 'ready' || options.mode !== 'target') return [];
    const mb = options.target === 'custom' ? Number(options.targetMb) : Number(options.target);
    return Number.isFinite(mb) && mb > 0
      ? [{ label: 'Estimate', value: `Just under ${String(mb)} MB` }]
      : [];
  },
  runLabel: 'Compress',
  outputExt: (options) => (options.codec === 'vp9' ? 'webm' : 'mp4'),
  outputSuffix: 'compressed',
  resultTitle: 'Compressed',
  runningNote: 'Keep this tab open while it compresses: the work happens on your device.',
};

/** V02 Compress Video (tools/video.md); the server path arrives with M4/M5. */
export default function CompressVideo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
