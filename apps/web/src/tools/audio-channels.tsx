'use client';

import { VERDICTS } from '@etb/core';
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
const engine = mediaEngine((m) => m.channelsEngine, MEDIA_META.audioEdit);

const OPTIONS: ShellOption[] = [
  {
    id: 'action',
    label: 'Change',
    kind: 'select',
    choices: [
      { value: 'mono-sum', label: 'Stereo to mono, both mixed' },
      { value: 'mono-left', label: 'Stereo to mono, left only' },
      { value: 'mono-right', label: 'Stereo to mono, right only' },
      { value: 'left-both', label: 'Left on both sides · fix one ear' },
      { value: 'right-both', label: 'Right on both sides · fix one ear' },
      { value: 'swap', label: 'Swap left and right' },
      { value: 'invert-right', label: 'Invert the right channel’s phase' },
      { value: 'invert-left', label: 'Invert the left channel’s phase' },
      { value: 'split', label: 'Split into two mono files' },
      { value: 'stereo', label: 'Mono to stereo' },
    ],
    default: 'mono-sum',
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

/** The file's length and format, and for stereo, what its two sides hold and the fix. */
async function probe(file: File): Promise<ProbeInfo> {
  const engines = await loadMediaEngines();
  const info = await engines.probeAudio(file);
  if (info.channels === 1) {
    return {
      durationSec: info.durationSec,
      summary: info.summary,
      values: { action: 'stereo' },
    };
  }
  const { verdict } = await engines.probeChannels(file);
  const found = verdict ? VERDICTS[verdict] : undefined;
  return {
    durationSec: info.durationSec,
    summary: info.summary,
    ...(found && verdict !== 'stereo' && { warnings: [found.text] }),
    ...(found?.fix && { values: { action: found.fix } }),
  };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac',
  dropTitle: 'Drop audio to fix its channels',
  chooseLabel: 'Choose audio',
  tapLabel: 'Choose audio',
  formats: (max) => `MP3, WAV, FLAC, OGG, M4A · mono or stereo · up to ${max}`,
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [['action'], ['format']],
  probe,
  runLabel: 'Apply',
  outputExt: (options) =>
    options.action === 'split' ? 'zip' : options.format === 'keep' ? '' : (options.format ?? ''),
  outputSuffix: 'channels',
  resultTitle: 'Done',
};

/** A13 Audio Channel Tools (tools/audio.md). */
export default function AudioChannels({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
