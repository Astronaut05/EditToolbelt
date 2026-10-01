'use client';

import { MEDIA_META, type AudioToVideoOptions, type Engine } from '@etb/engines';
import {
  fileOptionFile,
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { loadMediaEngines, mediaEngine } from './media-engine';

const inner = mediaEngine((m) => m.audioToVideoEngine, MEDIA_META.audioToVideo);

/** The shell's options as the engine takes them: the picture and the captions as files. */
const engine: Engine<Record<string, string>> = {
  capabilities: (caps) => inner.capabilities(caps),
  estimate: (input) => inner.estimate(input, {}),
  run: (file, options, ctx) => {
    const { image, captions, ...rest } = options;
    const chosen: AudioToVideoOptions = {
      ...rest,
      image: fileOptionFile(image ?? ''),
      captions: fileOptionFile(captions ?? ''),
    };
    return inner.run(file, chosen, ctx);
  },
};

const OPTIONS: ShellOption[] = [
  {
    id: 'size',
    label: 'Size',
    choices: [
      { value: 'portrait', label: '9:16' },
      { value: 'square', label: '1:1' },
      { value: 'landscape', label: '16:9' },
    ],
    default: 'portrait',
  },
  {
    id: 'style',
    label: 'Style',
    choices: [
      { value: 'bars', label: 'Bars' },
      { value: 'wave', label: 'Wave' },
    ],
    default: 'bars',
  },
  { id: 'color', label: 'Colour', kind: 'color', default: '#7dd3fc' },
  { id: 'background', label: 'Background', kind: 'color', default: '#101418' },
  {
    id: 'image',
    label: 'Picture',
    kind: 'file',
    accept: 'image/*,.jpg,.jpeg,.png,.webp,.avif',
    default: '',
  },
  { id: 'title', label: 'Title', kind: 'text', placeholder: 'Episode 12: the title', default: '' },
  {
    id: 'captions',
    label: 'Captions',
    kind: 'file',
    accept: '.srt,.vtt,.ass,.ssa,.sbv',
    default: '',
  },
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'mp4', label: 'MP4' },
      { value: 'webm', label: 'WebM' },
    ],
    default: 'mp4',
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
  dropTitle: 'Drop audio to turn into a video',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose an audio file',
  formats: 'MP3, WAV, FLAC, OGG, M4A · a video up to 10 min',
  formatsShort: 'MP3, WAV, FLAC, OGG, M4A',
  options: OPTIONS,
  phoneGroups: [
    ['size', 'style', 'color', 'background', 'image'],
    ['title', 'captions'],
    ['format'],
  ],
  probe,
  // A minute to start with: audiograms are short, and the timeline picks the part.
  initialRange: (duration) => ({ start: 0, end: Math.min(duration, 60) }),
  runLabel: 'Make video',
  outputExt: (options) => (options.format === 'webm' ? 'webm' : 'mp4'),
  outputSuffix: 'audiogram',
  resultTitle: 'Video made',
};

/** A16 Audio to Video (tools/audio.md). */
export default function AudioToVideo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
