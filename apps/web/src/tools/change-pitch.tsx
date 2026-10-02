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
const engine = mediaEngine((m) => m.pitchEngine, MEDIA_META.audioEdit);

const OPTIONS: ShellOption[] = [
  {
    id: 'mode',
    label: 'Change',
    choices: [
      { value: 'tempo', label: 'Tempo' },
      { value: 'pitch', label: 'Pitch' },
      { value: 'vinyl', label: 'Both, like vinyl' },
    ],
    default: 'tempo',
  },
  {
    id: 'tempo',
    label: 'Speed',
    kind: 'number',
    unit: '%',
    min: 25,
    max: 400,
    step: 1,
    default: '100',
    when: { id: 'mode', values: ['tempo', 'vinyl'] },
  },
  {
    id: 'semitones',
    label: 'Semitones',
    kind: 'select',
    choices: Array.from({ length: 25 }, (_, i) => {
      const n = i - 12;
      return { value: String(n), label: n > 0 ? `+${String(n)}` : n < 0 ? `−${String(-n)}` : '0' };
    }),
    default: '0',
    when: { id: 'mode', values: ['pitch'] },
  },
  {
    id: 'cents',
    label: 'Cents',
    kind: 'number',
    min: -50,
    max: 50,
    step: 1,
    default: '0',
    when: { id: 'mode', values: ['pitch'] },
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

async function probe(file: File): Promise<ProbeInfo> {
  const info = await (await loadMediaEngines()).probeAudio(file);
  if (!info.canDecode) {
    throw new Error('This browser can’t decode this audio. Try Chrome, Edge or Safari.');
  }
  return { durationSec: info.durationSec, summary: info.summary };
}

const clock = (seconds: number) => {
  const s = Math.round(seconds);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
};

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac',
  maxBytes: 1024 ** 3,
  dropTitle: 'Drop audio to change its speed or pitch',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose an audio file',
  formats: 'MP3, WAV, FLAC, OGG, M4A · up to 1 GB and 4 h',
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [['mode', 'tempo', 'semitones', 'cents'], ['format']],
  probe,
  facts: (_state, options, media) => {
    if (!media) return [];
    const tempo = Number(options.tempo) / 100;
    const length =
      options.mode === 'pitch' || !(tempo > 0) ? media.durationSec : media.durationSec / tempo;
    return [{ label: 'Length', value: `${clock(media.durationSec)} → ${clock(length)}` }];
  },
  blocked: (options) =>
    options.mode === 'pitch'
      ? Number(options.semitones) === 0 && Number(options.cents) === 0
        ? 'Set a pitch change.'
        : undefined
      : Number(options.tempo) === 100
        ? 'Set a speed other than 100%.'
        : undefined,
  runLabel: 'Apply',
  outputExt: (options) => (options.format && options.format !== 'keep' ? options.format : ''),
  outputSuffix: 'changed',
  resultTitle: 'Changed',
};

/** A08 Change Speed & Pitch (tools/audio.md). */
export default function ChangePitch({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
