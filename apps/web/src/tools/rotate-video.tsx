'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.rotateEngine, MEDIA_META.rotate);

const OPTIONS: ShellOption[] = [
  {
    id: 'rotate',
    label: 'Turn',
    choices: [
      { value: '0', label: 'None' },
      { value: '90', label: '90° right' },
      { value: '180', label: '180°' },
      { value: '270', label: '90° left' },
    ],
    default: '90',
  },
  {
    id: 'flip',
    label: 'Flip',
    choices: [
      { value: 'none', label: 'None' },
      { value: 'horizontal', label: 'Mirror' },
      { value: 'vertical', label: 'Upside down' },
    ],
    default: 'none',
  },
  {
    id: 'mode',
    label: 'How',
    choices: [
      { value: 'burn', label: 'Turn every frame' },
      { value: 'fast', label: 'Fast, by flag' },
    ],
    default: 'burn',
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to rotate',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [['rotate', 'flip'], ['mode']],
  probe: (file) => probeVideo(file),
  facts: (_state, options) => [
    {
      label: 'Playback',
      value:
        options.mode === 'fast'
          ? 'Instant and lossless: the file says how to turn it. A few web players ignore that'
          : 'Re-encoded at high quality: plays turned in every player',
    },
  ],
  blocked: (options) =>
    options.rotate === '0' && options.flip === 'none' ? 'Pick a turn or a flip.' : undefined,
  runLabel: 'Rotate video',
  // The file keeps its own format; the engine reports it.
  outputExt: () => '',
  outputSuffix: 'rotated',
  resultTitle: 'Rotated',
};

/** V11 Rotate & Flip Video (tools/video.md). */
export default function RotateVideo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
