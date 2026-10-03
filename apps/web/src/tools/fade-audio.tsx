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
const engine = mediaEngine((m) => m.fadeEngine, MEDIA_META.audioEdit);

const CURVES = [
  { value: 'linear', label: 'Linear' },
  { value: 'exponential', label: 'Exponential · slow start' },
  { value: 'logarithmic', label: 'Logarithmic · fast start' },
  { value: 's-curve', label: 'S-curve · smooth both ends' },
];

const OPTIONS: ShellOption[] = [
  {
    id: 'fadeIn',
    label: 'Fade in',
    kind: 'number',
    unit: 's',
    min: 0,
    max: 600,
    step: 0.1,
    default: '2',
  },
  { id: 'inCurve', label: 'Fade in curve', kind: 'select', choices: CURVES, default: 'linear' },
  {
    id: 'fadeOut',
    label: 'Fade out',
    kind: 'number',
    unit: 's',
    min: 0,
    max: 600,
    step: 0.1,
    default: '3',
  },
  { id: 'outCurve', label: 'Fade out curve', kind: 'select', choices: CURVES, default: 'linear' },
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
  dropTitle: 'Drop audio to fade',
  chooseLabel: 'Choose audio',
  tapLabel: 'Choose audio',
  formats: (max) => `MP3, WAV, FLAC, OGG, M4A · up to ${max}`,
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [['fadeIn', 'inCurve'], ['fadeOut', 'outCurve'], ['format']],
  probe,
  blocked: (options) =>
    (Number(options.fadeIn) || 0) <= 0 && (Number(options.fadeOut) || 0) <= 0
      ? 'Set a fade in or a fade out longer than 0 s.'
      : undefined,
  runLabel: 'Add fades',
  outputExt: (options) => (options.format === 'keep' ? '' : (options.format ?? '')),
  outputSuffix: 'faded',
  resultTitle: 'Faded',
};

/** A07 Fade In / Fade Out (tools/audio.md). */
export default function FadeAudio({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
