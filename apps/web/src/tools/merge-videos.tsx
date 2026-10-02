'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.mergeVideosEngine, MEDIA_META.mergeVideos);

const OPTIONS: ShellOption[] = [
  {
    id: 'transition',
    label: 'Between clips',
    choices: [
      { value: 'none', label: 'Cut' },
      { value: 'crossfade', label: 'Crossfade' },
    ],
    default: 'none',
  },
  {
    id: 'transitionLength',
    label: 'Crossfade',
    kind: 'select',
    choices: ['0.5', '1', '2'].map((s) => ({ value: s, label: `${s} s` })),
    default: '1',
    when: { id: 'transition', values: ['crossfade'] },
  },
  {
    id: 'size',
    label: 'Size',
    kind: 'select',
    choices: [
      { value: 'first', label: 'The first clip’s' },
      { value: '2160', label: '2160p (4K)' },
      { value: '1080', label: '1080p' },
      { value: '720', label: '720p' },
      { value: '480', label: '480p' },
    ],
    default: 'first',
  },
  {
    id: 'fps',
    label: 'Frame rate',
    kind: 'select',
    choices: [
      { value: 'first', label: 'The first clip’s' },
      ...['24', '25', '30', '50', '60'].map((f) => ({ value: f, label: `${f} fps` })),
    ],
    default: 'first',
  },
];

/** What each clip in the list is: size, frame rate, codecs and length. */
async function describe(file: File) {
  const { describeMedia, probeMedia } = await import('@etb/engines/media');
  const info = await probeMedia(file);
  if (!info.video) throw new Error('it has no video in it.');
  return { durationSec: info.durationSec, summary: describeMedia(info) };
}

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop clips to merge',
  chooseLabel: 'Choose clips',
  tapLabel: 'Choose clips',
  formats: 'MP4, MOV, WebM, MKV · 2 to 20 clips, each up to 2 GB',
  options: OPTIONS,
  phoneGroups: [
    ['transition', 'transitionLength'],
    ['size', 'fps'],
  ],
  combine: { min: 2, max: 20, describe },
  facts: (_state, options) => [
    {
      label: 'Speed',
      value:
        options.transition === 'none' && options.size === 'first' && options.fps === 'first'
          ? 'Clips with the same codec, size and settings are copied, not re-encoded: fast and lossless. Others are re-encoded to the first clip’s'
          : 'Re-encoded to one size and frame rate',
    },
  ],
  runLabel: 'Merge',
  // The first clip's format; the engine reports it.
  outputExt: () => '',
  outputSuffix: 'merged',
  resultTitle: 'Merged',
};

/** V12 Merge Videos (tools/video.md). */
export default function MergeVideos({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
