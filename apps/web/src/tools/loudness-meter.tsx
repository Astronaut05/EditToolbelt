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
const engine = mediaEngine((m) => m.loudnessMeterEngine, MEDIA_META.loudness);

const OPTIONS: ShellOption[] = [
  {
    id: 'export',
    label: 'Export',
    choices: [
      { value: 'txt', label: 'Report' },
      { value: 'csv', label: 'Every 100 ms (CSV)' },
    ],
    default: 'txt',
  },
];

async function probe(file: File): Promise<ProbeInfo> {
  const info = await (await loadMediaEngines()).probeAudio(file);
  return { durationSec: info.durationSec, summary: info.summary };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac,video/*',
  dropTitle: 'Drop audio or a video to measure',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose a file',
  formats: (max) => `MP3, WAV, FLAC, OGG, M4A, or a video’s sound · up to ${max}`,
  formatsShort: 'MP3, WAV, FLAC, M4A, video',
  options: OPTIONS,
  phoneGroups: [['export']],
  probe,
  // The numbers show as soon as the file is in; the download is the report.
  autoRun: true,
  runLabel: 'Measure loudness',
  outputExt: (options) => options.export ?? 'txt',
  outputSuffix: 'loudness',
  resultTitle: 'Loudness',
};

/** A06 Loudness Meter (tools/audio.md). */
export default function LoudnessMeter({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
