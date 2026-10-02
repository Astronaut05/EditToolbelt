'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.reverseVideoEngine, MEDIA_META.reverseVideo);

/** Past this, the page says reversing will take a while (tools/video.md → V18: long clips warn). */
const LONG_SECONDS = 5 * 60;

const OPTIONS: ShellOption[] = [
  {
    id: 'audio',
    label: 'Sound',
    choices: [
      { value: 'reverse', label: 'Reverse it too' },
      { value: 'mute', label: 'Leave it out' },
    ],
    default: 'reverse',
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to reverse',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  probe: async (file) => {
    const info = await probeVideo(file);
    if (info.durationSec <= LONG_SECONDS) return info;
    return {
      ...info,
      warnings: [
        ...(info.warnings ?? []),
        `Long clip: it is read backwards a few frames at a time, so ${String(Math.round(info.durationSec / 60))} min of video takes several minutes or more to reverse. Trim it first if you only need part of it.`,
      ],
    };
  },
  runLabel: 'Reverse',
  outputExt: () => '',
  outputSuffix: 'reversed',
  resultTitle: 'Reversed',
};

/** V18 Reverse Video (tools/video.md). */
export default function ReverseVideo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
