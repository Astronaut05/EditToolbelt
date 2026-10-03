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
const engine = mediaEngine((m) => m.removeSilenceEngine, MEDIA_META.trimAudio);

const OPTIONS: ShellOption[] = [
  {
    id: 'threshold',
    label: 'Silence below',
    kind: 'select',
    choices: [
      { value: 'auto', label: 'Auto, from the noise floor' },
      ...[-30, -35, -40, -45, -50, -55, -60].map((db) => ({
        value: String(db),
        label: `−${String(-db)} dBFS`,
      })),
    ],
    default: 'auto',
  },
  {
    id: 'minSilence',
    label: 'At least',
    kind: 'number',
    unit: 's',
    min: 0.1,
    max: 10,
    step: 0.1,
    default: '0.5',
  },
  {
    id: 'mode',
    label: 'Silences',
    choices: [
      { value: 'remove', label: 'Remove' },
      { value: 'shorten', label: 'Shorten' },
    ],
    default: 'remove',
  },
  {
    id: 'padding',
    label: 'Keep beside the sound',
    kind: 'number',
    unit: 's',
    min: 0,
    max: 1,
    step: 0.05,
    default: '0.1',
    when: { id: 'mode', values: ['remove'] },
  },
  {
    id: 'keep',
    label: 'Shorten to',
    kind: 'number',
    unit: 's',
    min: 0.05,
    max: 2,
    step: 0.05,
    default: '0.3',
    when: { id: 'mode', values: ['shorten'] },
  },
  {
    id: 'export',
    label: 'Export',
    choices: [
      { value: 'audio', label: 'Audio' },
      { value: 'csv', label: 'Cut list (CSV)' },
    ],
    default: 'audio',
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
    when: { id: 'export', values: ['audio'] },
  },
];

/** The length for the timeline and the waveform, as for Trim Audio. */
async function probe(file: File): Promise<ProbeInfo> {
  const engines = await loadMediaEngines();
  const info = await engines.probeAudio(file);
  if (!info.canDecode) {
    throw new Error(
      'This browser can’t decode this audio, so silences can’t be found. Try Chrome, Edge or Safari.',
    );
  }
  return {
    durationSec: info.durationSec,
    fps: 1000,
    summary: info.summary,
    waveform: async (buckets) => engines.audioPeaks(file, buckets),
  };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac',
  dropTitle: 'Drop a recording to remove its silences',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose a recording',
  formats: (max) => `MP3, WAV, FLAC, OGG, M4A · up to ${max} and 4 h`,
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [
    ['threshold', 'minSilence'],
    ['mode', 'padding', 'keep'],
    ['export', 'format'],
  ],
  probe,
  // The silences found are the timeline's ranges: move, drop or add any before cutting.
  ranges: true,
  detect: {
    deps: ['threshold', 'minSilence', 'mode', 'padding', 'keep'],
    run: async (file, options) =>
      (await (await loadMediaEngines()).detectSilences(file, options)).cuts,
    busy: 'Finding the silences…',
    empty: 'No silences found with these settings. Lower the threshold or the minimum length.',
  },
  runLabel: 'Remove silences',
  outputExt: (options) =>
    options.export === 'csv'
      ? 'csv'
      : options.format && options.format !== 'keep'
        ? options.format
        : '',
  outputSuffix: 'trimmed',
  resultTitle: 'Silences removed',
};

/** A11 Remove Silence (tools/audio.md). */
export default function RemoveSilence({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
