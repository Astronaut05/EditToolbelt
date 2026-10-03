'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.audioConverterEngine, MEDIA_META.audioConverter);

const LOSSY = { id: 'format', values: ['mp3', 'm4a', 'ogg'] };

const OPTIONS: ShellOption[] = [
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'mp3', label: 'MP3' },
      { value: 'wav', label: 'WAV' },
      { value: 'flac', label: 'FLAC' },
      { value: 'ogg', label: 'OGG' },
      { value: 'm4a', label: 'M4A' },
    ],
    default: 'mp3',
  },
  {
    id: 'bitrate',
    label: 'Bitrate',
    kind: 'select',
    choices: [
      { value: '64', label: '64 kbps · voice' },
      { value: '96', label: '96 kbps' },
      { value: '128', label: '128 kbps' },
      { value: '192', label: '192 kbps' },
      { value: '256', label: '256 kbps' },
      { value: '320', label: '320 kbps' },
    ],
    default: '192',
    when: LOSSY,
  },
  {
    id: 'bitDepth',
    label: 'Bit depth',
    choices: [
      { value: '16', label: '16-bit' },
      { value: '24', label: '24-bit' },
    ],
    default: '16',
    when: { id: 'format', values: ['wav'] },
  },
  {
    id: 'sampleRate',
    label: 'Sample rate',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: '44100', label: '44.1 kHz' },
      { value: '48000', label: '48 kHz' },
      { value: '96000', label: '96 kHz' },
    ],
    default: 'keep',
  },
  {
    id: 'channels',
    label: 'Channels',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: '1', label: 'Mono' },
      { value: '2', label: 'Stereo' },
    ],
    default: 'keep',
  },
];

const PRESET: ShellPreset = {
  noun: 'file',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac,video/*',
  multiple: true,
  maxFiles: 50,
  dropTitle: 'Drop audio files here',
  chooseLabel: 'Choose files',
  tapLabel: 'Choose audio files',
  formats: (max) => `MP3, WAV, FLAC, OGG, Opus, M4A, AAC · up to ${max} each · up to 50 at once`,
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [
    ['format', 'bitrate', 'bitDepth'],
    ['sampleRate', 'channels'],
  ],
  runLabel: 'Convert',
  outputExt: (options) => options.format ?? 'mp3',
  outputSuffix: '',
  resultTitle: 'Converted',
};

/** A01 Audio Converter (tools/audio.md). `to` presets the format on pair pages (/convert/wav-to-mp3). */
export default function AudioConverter({ tool, to }: { tool: ShellTool; to?: string }) {
  const formats = OPTIONS[0]?.choices?.map((choice) => choice.value) ?? [];
  const initialOptions = Object.fromEntries(
    OPTIONS.map((option) => [
      option.id,
      option.id === 'format' && to && formats.includes(to) ? to : option.default,
    ]),
  );
  return (
    <ToolShell
      tool={tool}
      preset={PRESET}
      engine={engine}
      initialOptions={initialOptions}
      onEvent={trackUnknown}
    />
  );
}
