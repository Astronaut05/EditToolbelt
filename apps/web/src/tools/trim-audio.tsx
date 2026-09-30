'use client';

import { audioPeaks, probeAudio, trimAudioEngine } from '@etb/engines';
import {
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';

const FADES = [
  { value: '0', label: 'None' },
  { value: '500', label: '0.5 s' },
  { value: '1000', label: '1 s' },
  { value: '2000', label: '2 s' },
  { value: '3000', label: '3 s' },
];

const OPTIONS: ShellOption[] = [
  {
    id: 'mode',
    label: 'Selection',
    choices: [
      { value: 'keep', label: 'Keep it' },
      { value: 'remove', label: 'Remove it' },
    ],
    default: 'keep',
  },
  { id: 'fadeIn', label: 'Fade in', kind: 'select', choices: FADES, default: '0' },
  { id: 'fadeOut', label: 'Fade out', kind: 'select', choices: FADES, default: '0' },
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

/** Reads the audio as it arrives: its length for the timeline, and the waveform. */
async function probe(file: File): Promise<ProbeInfo> {
  const info = await probeAudio(file);
  const warnings = info.canDecode
    ? []
    : [
        'This browser can’t decode this audio, so there’s no waveform and only a plain cut without fades works. Try Chrome, Edge or Safari.',
      ];
  return {
    durationSec: info.durationSec,
    // Millisecond steps: the arrow keys move the playhead 1 ms, Shift+arrow 1 s.
    fps: 1000,
    summary: info.summary,
    warnings,
    waveform: (buckets) => audioPeaks(file, buckets),
  };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac',
  maxBytes: 1024 ** 3,
  dropTitle: 'Drop audio to trim',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose an audio file',
  formats: 'MP3, WAV, FLAC, OGG, M4A · up to 1 GB and 4 h',
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [
    ['mode', 'format'],
    ['fadeIn', 'fadeOut'],
  ],
  probe,
  runLabel: 'Trim',
  // Keep writes the file's own format; the engine reports it.
  outputExt: (options) => (options.format && options.format !== 'keep' ? options.format : ''),
  outputSuffix: 'trimmed',
  resultTitle: 'Trimmed',
};

/** A02 Trim Audio (tools/audio.md). */
export default function TrimAudio({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={trimAudioEngine} onEvent={trackUnknown} />;
}
