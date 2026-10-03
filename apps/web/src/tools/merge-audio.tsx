'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { loadMediaEngines, mediaEngine } from './media-engine';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.mergeAudioEngine, MEDIA_META.audioEdit);

const OPTIONS: ShellOption[] = [
  {
    id: 'join',
    label: 'Join',
    choices: [
      { value: 'cut', label: 'Back to back' },
      { value: 'crossfade', label: 'Crossfade' },
      { value: 'gap', label: 'With gaps' },
      { value: 'mix', label: 'Mix together' },
    ],
    default: 'crossfade',
  },
  {
    id: 'joinLength',
    label: 'Length',
    kind: 'select',
    choices: ['0.5', '1', '2', '3', '5'].map((s) => ({ value: s, label: `${s} s` })),
    default: '1',
    when: { id: 'join', values: ['crossfade', 'gap'] },
  },
  {
    id: 'normalize',
    label: 'Normalize',
    kind: 'select',
    choices: [
      { value: 'off', label: 'Off' },
      { value: '-14', label: '−14 LUFS, streaming' },
      { value: '-16', label: '−16 LUFS, podcasts' },
      { value: '-23', label: '−23 LUFS, broadcast' },
    ],
    default: 'off',
  },
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'mp3', label: 'MP3' },
      { value: 'wav', label: 'WAV' },
      { value: 'flac', label: 'FLAC' },
    ],
    default: 'keep',
  },
];

/** What each file in the list holds: format, rate, channels and length. */
async function describe(file: File) {
  const info = await (await loadMediaEngines()).probeAudio(file);
  if (!info.canDecode) throw new Error('this browser can’t decode it.');
  return { durationSec: info.durationSec, summary: info.summary.replace(/ · [\d:]+$/, '') };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac',
  dropTitle: 'Drop audio files to merge',
  chooseLabel: 'Choose files',
  tapLabel: 'Choose audio files',
  formats: (max) => `MP3, WAV, FLAC, OGG, M4A · 2 to 20 files, each up to ${max}`,
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [
    ['join', 'joinLength'],
    ['normalize', 'format'],
  ],
  combine: { min: 2, max: 20, describe },
  runLabel: 'Merge',
  outputExt: (options) => (options.format && options.format !== 'keep' ? options.format : ''),
  outputSuffix: 'merged',
  resultTitle: 'Merged',
};

/** A04 Merge Audio (tools/audio.md). */
export default function MergeAudio({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
