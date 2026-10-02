'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.loopVideoEngine, MEDIA_META.loopVideo);

const OPTIONS: ShellOption[] = [
  {
    id: 'mode',
    label: 'Repeat',
    choices: [
      { value: 'times', label: 'A number of times' },
      { value: 'length', label: 'To a length' },
    ],
    default: 'times',
  },
  {
    id: 'times',
    label: 'Times',
    kind: 'number',
    unit: '×',
    min: 2,
    max: 50,
    step: 1,
    default: '3',
    when: { id: 'mode', values: ['times'] },
  },
  {
    id: 'length',
    label: 'Length',
    kind: 'number',
    unit: 's',
    min: 1,
    max: 3600,
    step: 0.5,
    default: '30',
    when: { id: 'mode', values: ['length'] },
  },
  {
    id: 'boomerang',
    label: 'Boomerang',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'Forwards, then back' },
    ],
    default: 'off',
  },
  {
    id: 'audio',
    label: 'Sound',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'mute', label: 'Leave it out' },
    ],
    default: 'keep',
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to loop',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [['mode', 'times', 'length'], ['boomerang'], ['audio']],
  probe: (file) => probeVideo(file),
  facts: (_state, options, media) => {
    if (!media) return [];
    const fps = media.fps ?? 30;
    // A boomerang's loop doesn't repeat the two frames it turns on. The probed length can
    // leave out the last frame's own time (Matroska), so the loop is shown, not a total to the frame.
    const loop = options.boomerang === 'on' ? 2 * media.durationSec - 2 / fps : media.durationSec;
    if (options.mode === 'length') {
      const length = Number(options.length);
      return length > 0 ? [{ label: 'Result', value: `${String(length)} s` }] : [];
    }
    const times = Number(options.times);
    return times > 0 ? [{ label: 'Result', value: `${String(times)} × ${loop.toFixed(1)} s` }] : [];
  },
  blocked: (options) => {
    if (options.mode === 'length') {
      const length = Number(options.length);
      return length > 0 && length <= 3600 ? undefined : 'Set a length from 1 s to 60 min.';
    }
    const times = Number(options.times);
    return Number.isInteger(times) && times >= 2 && times <= 50
      ? undefined
      : 'Repeat it 2 to 50 times.';
  },
  runLabel: 'Loop',
  outputExt: () => '',
  outputSuffix: 'loop',
  resultTitle: 'Looped',
};

/** V19 Loop Video (tools/video.md). */
export default function LoopVideo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
