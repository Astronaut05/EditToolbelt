'use client';

import { MEDIA_META } from '@etb/engines';
import {
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { loadMediaEngines, mediaEngine } from './media-engine';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.normalizeEngine, MEDIA_META.loudness);

const OPTIONS: ShellOption[] = [
  {
    id: 'target',
    label: 'Target',
    kind: 'select',
    choices: [
      { value: '-14', label: 'Streaming, YouTube · −14 LUFS' },
      { value: '-16', label: 'Podcast · −16 LUFS' },
      { value: '-23', label: 'Broadcast, EBU R128 · −23 LUFS' },
      { value: '-24', label: 'Film and TV, US · −24 LKFS' },
      { value: 'custom', label: 'Custom' },
    ],
    default: '-14',
  },
  {
    id: 'custom',
    label: 'Custom target',
    kind: 'number',
    unit: 'LUFS',
    min: -40,
    max: -5,
    step: 0.5,
    default: '-18',
    when: { id: 'target', values: ['custom'] },
  },
  {
    id: 'mode',
    label: 'Mode',
    choices: [
      { value: 'limit', label: 'Gain + limiter' },
      { value: 'gain', label: 'Gain only' },
    ],
    default: 'limit',
  },
  {
    id: 'ceiling',
    label: 'True-peak ceiling',
    kind: 'number',
    unit: 'dBTP',
    min: -9,
    max: 0,
    step: 0.1,
    default: '-1',
  },
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'wav', label: 'WAV' },
      { value: 'flac', label: 'FLAC' },
      { value: 'mp3', label: 'MP3' },
      { value: 'm4a', label: 'M4A' },
    ],
    default: 'keep',
  },
];

async function probe(file: File): Promise<ProbeInfo> {
  const info = await (await loadMediaEngines()).probeAudio(file);
  return { durationSec: info.durationSec, summary: info.summary };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac',
  dropTitle: 'Drop audio to normalize',
  chooseLabel: 'Choose audio',
  tapLabel: 'Choose audio',
  formats: (max) => `MP3, WAV, FLAC, OGG, M4A · up to ${max}`,
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [['target', 'custom'], ['mode', 'ceiling'], ['format']],
  probe,
  facts: (_state, options) => [
    {
      label: 'Peaks',
      value:
        options.mode === 'gain'
          ? 'Gain only: if the peaks would go over the ceiling, the gain stops there'
          : 'A true-peak limiter holds the peaks under the ceiling when the gain needs it',
    },
  ],
  runLabel: 'Normalize',
  outputExt: (options) => (options.format === 'keep' ? '' : (options.format ?? '')),
  outputSuffix: 'normalized',
  resultTitle: 'Normalized',
};

/** A05 Normalize Loudness (tools/audio.md). */
export default function NormalizeAudio({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
