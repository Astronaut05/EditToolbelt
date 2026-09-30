'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.muteVideoEngine, MEDIA_META.mute);

const OPTIONS: ShellOption[] = [
  {
    id: 'mode',
    label: 'Mute',
    choices: [
      { value: 'all', label: 'All the audio' },
      { value: 'range', label: 'The selection' },
    ],
    default: 'all',
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to mute',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  probe: (file) => probeVideo(file),
  runLabel: 'Mute',
  // The file keeps its own format; the engine reports it.
  outputExt: () => '',
  outputSuffix: 'muted',
  resultTitle: 'Muted',
};

/** V07 Mute Video (tools/video.md). The timeline picks the range for "The selection". */
export default function MuteVideo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
