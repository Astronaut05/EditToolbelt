'use client';

import { dummyEngine } from '@etb/engines';
import { ToolShell, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import type { DemoType } from './demoTypes';
import { removeBackgroundPreset } from './removeBackground';

const base = {
  runtime: 'client' as const,
  related: [
    { name: 'Resize Image', href: '/resize-image' },
    { name: 'Compress Image', href: '/compress-image' },
  ],
};

const format = {
  id: 'format',
  label: 'Format',
  default: 'mp3',
  choices: [
    { value: 'mp3', label: 'MP3' },
    { value: 'wav', label: 'WAV' },
  ],
};

const DEMOS: Record<DemoType, { tool: ShellTool; preset: ShellPreset }> = {
  form: {
    tool: {
      ...base,
      id: 'normalize-audio',
      name: 'Normalize Audio',
      h1: 'Normalize Audio Loudness',
      tagline: 'Set loudness to a LUFS target for podcasts, YouTube or streaming.',
      ui: 'form',
      category: { name: 'Audio', href: '/audio' },
    },
    preset: {
      noun: 'audio',
      accept: 'audio/*',
      maxBytes: 500_000_000,
      dropTitle: 'Drop an audio file here',
      chooseLabel: 'Choose audio',
      tapLabel: 'Choose\nan audio file',
      formats: 'MP3 · WAV · M4A · FLAC · OGG · up to 500 MB',
      options: [
        {
          id: 'target',
          label: 'Target',
          default: '-14',
          choices: [
            { value: '-14', label: '-14 LUFS' },
            { value: '-16', label: '-16 LUFS' },
            { value: '-23', label: '-23 LUFS' },
          ],
        },
        format,
      ],
      outputExt: (o) => o.format ?? 'mp3',
      outputSuffix: 'normalized',
      resultTitle: 'Loudness set',
      runLabel: 'Normalize audio',
    },
  },
  'canvas-editor': {
    tool: {
      ...base,
      id: 'crop-image',
      name: 'Crop Image',
      h1: 'Crop Image',
      tagline: 'Crop to a ratio, exact pixels or freehand.',
      ui: 'canvas-editor',
      category: { name: 'Photo', href: '/photo' },
    },
    preset: {
      ...removeBackgroundPreset,
      autoRun: false,
      runLabel: 'Crop image',
      options: [
        {
          id: 'ratio',
          label: 'Ratio',
          default: 'free',
          choices: [
            { value: 'free', label: 'Free' },
            { value: '1:1', label: '1:1' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
          ],
        },
      ],
      facts: undefined,
      editor: { mode: 'crop' },
      outputExt: () => 'png',
      outputSuffix: 'cropped',
      resultTitle: 'Cropped',
    },
  },
  timeline: {
    tool: {
      ...base,
      id: 'trim-video',
      name: 'Trim Video',
      h1: 'Trim Video',
      tagline: 'Cut the start and end off a clip, keyframe-fast or frame-exact.',
      ui: 'timeline',
      category: { name: 'Video', href: '/video' },
    },
    preset: {
      noun: 'video',
      accept: 'video/*',
      maxBytes: 2_000_000_000,
      dropTitle: 'Drop a video here',
      chooseLabel: 'Choose video',
      tapLabel: 'Choose\na video',
      formats: 'MP4 · MOV · WEBM · up to 2 GB',
      options: [
        {
          id: 'mode',
          label: 'Mode',
          default: 'fast',
          choices: [
            { value: 'fast', label: 'Fast' },
            { value: 'precise', label: 'Precise' },
          ],
        },
      ],
      outputExt: () => 'mp4',
      outputSuffix: 'trimmed',
      resultTitle: 'Trimmed',
      runLabel: 'Trim video',
    },
  },
  analyzer: {
    tool: {
      ...base,
      id: 'bpm-key-finder',
      name: 'BPM & Key Finder',
      h1: 'Find the BPM and Key of a Song',
      tagline: 'Tempo in BPM and musical key, read in your browser.',
      ui: 'analyzer',
      category: { name: 'Audio', href: '/audio' },
    },
    preset: {
      noun: 'audio',
      accept: 'audio/*',
      maxBytes: 500_000_000,
      dropTitle: 'Drop a song here',
      chooseLabel: 'Choose audio',
      tapLabel: 'Choose\na song',
      formats: 'MP3 · WAV · M4A · FLAC · up to 500 MB',
      options: [],
      autoRun: true,
      outputExt: () => 'txt',
      outputSuffix: 'analysis',
      resultTitle: 'Analysis',
      analyze: () => [
        { label: 'Tempo', value: '124', unit: 'BPM' },
        { label: 'Key', value: 'A minor' },
        { label: 'Camelot', value: '8A' },
        { label: 'Confidence', value: '0.92' },
      ],
    },
  },
  calculator: {
    tool: {
      ...base,
      id: 'aspect-ratio-calculator',
      name: 'Aspect Ratio Calculator',
      h1: 'Aspect Ratio Calculator',
      tagline: 'Ratio, decimal and megapixels from any width and height.',
      ui: 'calculator',
      category: { name: 'Subtitles & Time', href: '/subtitles-time' },
    },
    preset: { ...removeBackgroundPreset, options: [] },
  },
  batch: {
    tool: {
      ...base,
      id: 'compress-image',
      name: 'Compress Image',
      h1: 'Compress Images',
      tagline: 'Smaller JPG, PNG and WebP files, many at once.',
      ui: 'batch',
      category: { name: 'Photo', href: '/photo' },
    },
    preset: {
      ...removeBackgroundPreset,
      multiple: true,
      autoRun: false,
      runLabel: 'Compress images',
      options: [
        {
          id: 'quality',
          label: 'Quality',
          default: '80',
          choices: [
            { value: '60', label: '60' },
            { value: '80', label: '80' },
            { value: '90', label: '90' },
          ],
        },
      ],
      facts: undefined,
      outputExt: () => 'jpg',
      outputSuffix: 'small',
      resultTitle: 'Compressed',
    },
  },
};

/** A working ToolShell for one ui type, against the dummy engine (docs/12 → M1). */
export function ToolDemo({ type }: { type: DemoType }) {
  const demo = DEMOS[type];
  return (
    <ToolShell
      tool={demo.tool}
      preset={demo.preset}
      engine={dummyEngine}
      engineOptions={{ durationMs: 1800, stages: ['Reading the file', 'Working'] }}
      onEvent={trackUnknown}
    />
  );
}
