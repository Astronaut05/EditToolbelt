'use client';

import { NOISE_PREVIEW_SECONDS } from '@etb/core';
import {
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellServer,
  type ShellTool,
} from '@etb/ui';
import { useMemo } from 'react';

import { trackUnknown } from '../lib/analytics';
import { serverPath } from '../lib/server-run';
import { loadMediaEngines } from './media-engine';
import { serverOptionsFor, soundPlan } from './remove-noise-plan';

type NoiseProbe = Awaited<ReturnType<Awaited<ReturnType<typeof loadMediaEngines>>['probeNoise']>>;

const OPTIONS: ShellOption[] = [
  {
    id: 'strength',
    label: 'Strength',
    choices: [
      { value: 'light', label: 'Light' },
      { value: 'medium', label: 'Medium' },
      { value: 'strong', label: 'Strong' },
    ],
    default: 'medium',
  },
  {
    id: 'dehum',
    label: 'De-hum',
    choices: [
      { value: 'off', label: 'Off' },
      { value: '50', label: '50 Hz' },
      { value: '60', label: '60 Hz' },
    ],
    default: 'off',
  },
  {
    id: 'deess',
    label: 'De-ess',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
    default: 'off',
  },
  {
    id: 'format',
    label: 'Format',
    kind: 'select',
    choices: [
      { value: 'keep', label: 'Keep · same as the file' },
      { value: 'wav', label: 'WAV' },
      { value: 'flac', label: 'FLAC' },
      { value: 'mp3', label: 'MP3' },
      { value: 'm4a', label: 'M4A (AAC)' },
      { value: 'ogg', label: 'OGG (Opus)' },
    ],
    default: 'keep',
  },
  {
    id: 'previewFrom',
    label: 'Preview from',
    kind: 'number',
    unit: 's',
    min: 0,
    step: 1,
    default: '0',
  },
];

const REDUCTION: Record<string, string> = {
  light: 'up to 12 dB less',
  medium: 'up to 24 dB less',
  strong: 'up to 40 dB less',
};

/** What the probe found, by file: the run needs it again (the sound's type, a video or not). */
const probed = new WeakMap<File, NoiseProbe>();

async function probe(file: File): Promise<ProbeInfo> {
  const info = await (await loadMediaEngines()).probeNoise(file);
  probed.set(file, info);
  const warnings = [
    ...(info.hum !== 'off'
      ? [`Mains hum at ${info.hum} Hz in the first minutes, so De-hum is set to ${info.hum} Hz.`]
      : []),
    ...(info.video
      ? [
          'Only the sound goes to our servers, as lossless FLAC. It comes back into this video in your browser; the picture is never uploaded.',
        ]
      : []),
  ];
  return {
    durationSec: info.durationSec,
    summary: info.summary,
    values: {
      previewFrom: String(Math.floor(info.previewFrom)),
      ...(info.hum !== 'off' && { dehum: info.hum }),
    },
    warnings: warnings.length ? warnings : undefined,
  };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept:
    'audio/*,video/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac,.aif,.aiff,.mp4,.mov,.webm,.mkv',
  // Videos are read in the browser, and only their sound is sent.
  maxBytes: 10 * 1024 ** 3,
  dropTitle: 'Drop a voice recording or a video',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose a file',
  formats: 'MP3, WAV, FLAC, OGG, M4A, or a video · up to 1 h free, 4 h with credits',
  formatsShort: 'Audio or video',
  options: OPTIONS,
  phoneGroups: [['strength'], ['dehum', 'deess'], ['format'], ['previewFrom']],
  probe,
  facts: (_state, options) => [
    { label: 'Noise', value: REDUCTION[options.strength ?? 'medium'] ?? '' },
    { label: 'Length', value: 'Exactly the same, to the sample; peaks stay under −1 dBTP' },
  ],
  serverReason:
    'Noise reduction runs on our servers, with ffmpeg’s FFT noise filter. Preview 10 s for free first.',
  runLabel: 'Clean',
  outputExt: (options) => (options.format === 'keep' ? '' : (options.format ?? '')),
  outputSuffix: 'clean',
  resultTitle: 'Cleaned',
};

/** A10 Noise Reduction (tools/audio.md): on our servers, with the browser cutting the preview and handling video. */
export default function RemoveNoise({ tool }: { tool: ShellTool }) {
  const info = tool.server;
  const server = useMemo((): ShellServer | undefined => {
    if (!info) return undefined;
    const base = serverPath(
      tool.id,
      info,
      serverOptionsFor,
      typeof window === 'undefined' ? '/' : window.location.pathname,
    );
    const known = async (file: File) => {
      const engines = await loadMediaEngines();
      const found = probed.get(file) ?? (await engines.probeNoise(file));
      return { engines, found };
    };
    return {
      ...base,
      uploadBytes: (file) => probed.get(file)?.sendBytes ?? file.size,
      async run(file, options, ctx) {
        const { engines, found } = await known(file);
        const plan = soundPlan(found, options.format ?? 'keep');
        let send: File;
        if (found.serverType) {
          // The page's own name: the original's never leaves the page.
          send = new File([file], `sound.${found.serverType.ext}`, { type: found.serverType.mime });
        } else {
          const progress = (fraction: number) => {
            ctx.progress({ stage: 'Reading the sound', fraction });
          };
          progress(0);
          const flac = await engines.soundAsFlac(file, ctx.signal, progress);
          send = new File([flac], 'sound.flac', { type: 'audio/flac' });
        }
        const cleaned = await base.run(send, { ...options, format: plan.format }, ctx);
        if (!plan.backIntoVideo) return cleaned;
        ctx.progress({ stage: 'Putting the sound back', fraction: 0 });
        const video = await engines.putSoundBack(file, cleaned.blob, ctx.signal, (fraction) => {
          ctx.progress({ stage: 'Putting the sound back', fraction });
        });
        return {
          blob: video.blob,
          ext: video.ext,
          notes: [...(cleaned.notes ?? []), ...(video.notes ?? [])],
        };
      },
      preview: {
        seconds: NOISE_PREVIEW_SECONDS,
        async run(file, options, ctx) {
          const { engines, found } = await known(file);
          ctx.progress({ stage: 'Cutting the preview' });
          const { wav, from } = await engines.previewSnippet(
            file,
            Number(options.previewFrom) || 0,
            ctx.signal,
          );
          const cleaned = await base.run(
            new File([wav], 'preview.wav', { type: 'audio/wav' }),
            { ...options, preview: 'on' },
            ctx,
          );
          return {
            original: wav,
            result: cleaned.blob,
            fromSec: from,
            durationSec: Math.min(NOISE_PREVIEW_SECONDS, found.durationSec - from),
            notes: cleaned.notes,
          };
        },
      },
    };
  }, [info, tool.id]);
  return <ToolShell tool={tool} preset={PRESET} onEvent={trackUnknown} server={server} />;
}
