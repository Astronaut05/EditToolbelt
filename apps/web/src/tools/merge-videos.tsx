'use client';

import { MEDIA_META } from '@etb/engines';
import { MERGE_VIDEOS } from '@etb/registry/choices';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';
import { useMemo } from 'react';

import { trackUnknown } from '../lib/analytics';
import { serverPath } from '../lib/server-run';
import { mediaEngine } from './media-engine';
import { VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.mergeVideosEngine, MEDIA_META.mergeVideos);

const FIRST = 'The first clip’s';
const TRANSITIONS: Record<(typeof MERGE_VIDEOS.transitions)[number], string> = {
  none: 'Cut',
  crossfade: 'Crossfade',
};

// The same choices our servers take (@etb/registry/choices → MERGE_VIDEOS).
const OPTIONS: ShellOption[] = [
  {
    id: 'transition',
    label: 'Between clips',
    choices: MERGE_VIDEOS.transitions.map((t) => ({ value: t, label: TRANSITIONS[t] })),
    default: 'none',
  },
  {
    id: 'transitionLength',
    label: 'Crossfade',
    kind: 'select',
    choices: MERGE_VIDEOS.crossfades.map((s) => ({ value: s, label: `${s} s` })),
    default: '1',
    when: { id: 'transition', values: ['crossfade'] },
  },
  {
    id: 'size',
    label: 'Size',
    kind: 'select',
    choices: MERGE_VIDEOS.sizes.map((h) => ({
      value: h,
      label: h === 'first' ? FIRST : h === '2160' ? '2160p (4K)' : `${h}p`,
    })),
    default: 'first',
  },
  {
    id: 'fps',
    label: 'Frame rate',
    kind: 'select',
    choices: MERGE_VIDEOS.fps.map((f) => ({
      value: f,
      label: f === 'first' ? FIRST : `${f} fps`,
    })),
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
  formats: 'MP4, MOV, WebM, MKV · 2 to 20 clips, up to 2 GB in all',
  options: OPTIONS,
  phoneGroups: [
    ['transition', 'transitionLength'],
    ['size', 'fps'],
  ],
  combine: { min: MERGE_VIDEOS.minClips, max: MERGE_VIDEOS.maxClips, describe },
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

/** The same settings for our servers (@etb/registry/options → merge-videos); the clips go with them. */
const toServerOptions = (options: Record<string, string>) => ({
  transition: options.transition,
  transitionLength: options.transitionLength,
  size: options.size,
  fps: options.fps,
});

/** V12 Merge Videos (tools/video.md): in the browser, or ffmpeg on our servers for large totals. */
export default function MergeVideos({ tool }: { tool: ShellTool }) {
  const info = tool.server;
  const server = useMemo(
    () =>
      info &&
      serverPath(
        tool.id,
        info,
        toServerOptions,
        typeof window === 'undefined' ? '/' : window.location.pathname,
        [],
        { joined: 'clips' },
      ),
    [info, tool.id],
  );
  return (
    <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} server={server} />
  );
}
