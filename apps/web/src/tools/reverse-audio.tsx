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
const engine = mediaEngine((m) => m.reverseAudioEngine, MEDIA_META.audioEdit);

const OPTIONS: ShellOption[] = [
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

/** Reads the audio as it arrives: its length for the timeline, and the waveform. */
async function probe(file: File): Promise<ProbeInfo> {
  const info = await (await loadMediaEngines()).probeAudio(file);
  return {
    durationSec: info.durationSec,
    fps: 1000,
    summary: info.summary,
    ...(!info.canDecode && {
      warnings: ['This browser can’t decode this audio. Try Chrome, Edge or Safari.'],
    }),
    waveform: async (buckets) => (await loadMediaEngines()).audioPeaks(file, buckets),
  };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac',
  maxBytes: 1024 ** 3,
  dropTitle: 'Drop audio to reverse',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose an audio file',
  formats: 'MP3, WAV, FLAC, OGG, M4A · up to 1 GB and 4 h',
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  probe,
  runLabel: 'Reverse',
  outputExt: (options) => (options.format && options.format !== 'keep' ? options.format : ''),
  outputSuffix: 'reversed',
  resultTitle: 'Reversed',
};

/** A15 Reverse Audio (tools/audio.md). The whole file is selected at first; a smaller selection reverses only that. */
export default function ReverseAudio({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
