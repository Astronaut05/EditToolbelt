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
const engine = mediaEngine((m) => m.splitAudioEngine, MEDIA_META.trimAudio);

const OPTIONS: ShellOption[] = [
  {
    id: 'split',
    label: 'Where to split',
    kind: 'select',
    choices: [
      { value: 'equal', label: 'Into equal parts' },
      { value: 'length', label: 'Into pieces of a length' },
      { value: 'silence', label: 'At silences' },
      { value: 'marks', label: 'By hand, on the timeline' },
    ],
    default: 'equal',
  },
  {
    id: 'parts',
    label: 'Parts',
    kind: 'number',
    min: 2,
    max: 50,
    step: 1,
    default: '2',
    when: { id: 'split', values: ['equal'] },
  },
  {
    id: 'pieceLength',
    label: 'Each piece',
    kind: 'number',
    unit: 's',
    min: 1,
    max: 3600,
    step: 1,
    default: '60',
    when: { id: 'split', values: ['length'] },
  },
  {
    id: 'threshold',
    label: 'Silence below',
    kind: 'select',
    choices: [
      { value: 'auto', label: 'Auto' },
      ...[-30, -35, -40, -45, -50, -55, -60].map((db) => ({
        value: String(db),
        label: `−${String(-db)} dBFS`,
      })),
    ],
    default: 'auto',
    when: { id: 'split', values: ['silence'] },
  },
  {
    id: 'minSilence',
    label: 'At least',
    kind: 'number',
    unit: 's',
    min: 0.2,
    max: 10,
    step: 0.1,
    default: '1',
    when: { id: 'split', values: ['silence'] },
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

/** The length for the timeline and the waveform, as for Trim Audio. */
async function probe(file: File): Promise<ProbeInfo> {
  const engines = await loadMediaEngines();
  const info = await engines.probeAudio(file);
  return {
    durationSec: info.durationSec,
    fps: 1000,
    summary: info.summary,
    ...(!info.canDecode && {
      warnings: [
        'This browser can’t decode this audio: no waveform, and no splitting at silences. Equal parts and pieces of a length still work.',
      ],
    }),
    waveform: async (buckets) => engines.audioPeaks(file, buckets),
  };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac',
  dropTitle: 'Drop audio to split',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose an audio file',
  formats: (max) => `MP3, WAV, FLAC, OGG, M4A · up to ${max} and 4 h`,
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [['split', 'parts', 'pieceLength', 'threshold', 'minSilence'], ['format']],
  probe,
  // The parts are the timeline's ranges: filled in from the settings, then move, drop or add any.
  ranges: true,
  detect: {
    deps: ['split', 'parts', 'pieceLength', 'threshold', 'minSilence'],
    run: async (file, options) => (await loadMediaEngines()).detectSplits(file, options),
    busy: 'Finding the parts…',
    empty:
      'No parts with these settings: a split makes 2 to 50. Use longer pieces, or lower the silence threshold.',
  },
  runLabel: 'Split',
  outputExt: () => 'zip',
  outputSuffix: 'parts',
  resultTitle: 'Split',
};

/** A14 Split Audio (tools/audio.md). */
export default function SplitAudio({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
