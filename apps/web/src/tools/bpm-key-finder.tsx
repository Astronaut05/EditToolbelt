'use client';

import { bpmKeyEngine, probeAudio } from '@etb/engines';
import {
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';

const OPTIONS: ShellOption[] = [
  {
    id: 'range',
    label: 'Tempo range',
    kind: 'select',
    choices: [
      { value: 'auto', label: 'Auto' },
      { value: 'slow', label: '60–90 BPM · ballads, hip-hop' },
      { value: 'mid', label: '90–140 BPM · pop, house' },
      { value: 'fast', label: '140–200 BPM · drum & bass, punk' },
    ],
    default: 'auto',
  },
  {
    id: 'markers',
    label: 'Beat markers',
    choices: [
      { value: 'csv', label: 'CSV' },
      { value: 'txt', label: 'TXT' },
    ],
    default: 'csv',
  },
];

async function probe(file: File): Promise<ProbeInfo> {
  const info = await probeAudio(file);
  return { durationSec: info.durationSec, summary: info.summary };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac',
  maxBytes: 1024 ** 3,
  dropTitle: 'Drop a song here',
  chooseLabel: 'Choose a song',
  tapLabel: 'Choose a song',
  formats: 'MP3, WAV, FLAC, OGG, M4A · up to 30 min',
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [['range', 'markers']],
  probe,
  // Tempo and key show as soon as the song is in; the download is the beat markers.
  autoRun: true,
  runLabel: 'Find tempo and key',
  outputExt: (options) => options.markers ?? 'csv',
  outputSuffix: 'beats',
  resultTitle: 'Tempo and key',
  tempo: true,
};

/** A03 BPM & Key Finder (tools/audio.md). */
export default function BpmKeyFinder({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={bpmKeyEngine} onEvent={trackUnknown} />;
}
