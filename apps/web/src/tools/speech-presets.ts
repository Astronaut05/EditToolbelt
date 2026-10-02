import { FIRST_LANGUAGES, WHISPER_LANGUAGES, type WhisperLanguage } from '@etb/registry/languages';
import type { ProbeInfo, ServerRunContext, ShellOption } from '@etb/ui';

import { loadMediaEngines } from './media-engine';
import { probeVideo } from './video-presets';

/**
 * Shared bits of the two speech tools (A12 Transcribe Audio, V17 Auto
 * Subtitles): the language list, what they take, the probe, and V17's step
 * that sends only a video's sound.
 */

export const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac,.weba';
export const AUDIO_FORMATS = 'MP3, WAV, M4A, FLAC, OGG, WebM';

/** Auto, then Uzbek, Russian and English, then the rest by name. */
export const LANGUAGE_OPTION: ShellOption = {
  id: 'language',
  label: 'Language',
  kind: 'select',
  choices: [
    { value: 'auto', label: 'Auto · detect it' },
    ...FIRST_LANGUAGES.map((code) => ({ value: code, label: WHISPER_LANGUAGES[code] })),
    ...(Object.entries(WHISPER_LANGUAGES) as [WhisperLanguage, string][])
      .filter(([code]) => !FIRST_LANGUAGES.includes(code))
      .map(([code, name]) => ({ value: code, label: name })),
  ],
  default: 'auto',
};

/** Line length as the API takes it: a whole number from 16 to 80 (42 when it's not). */
export function lineLength(value: string | undefined): number {
  const chars = Math.round(Number(value));
  return Number.isFinite(chars) && chars >= 16 && chars <= 80 ? chars : 42;
}

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'weba'].includes(ext);
}

/** An audio file's length and a one-line summary. */
export async function probeSpeech(file: File): Promise<ProbeInfo> {
  if (!isAudioFile(file)) return probeVideo(file, true, true);
  const info = await (await loadMediaEngines()).probeAudio(file);
  return { durationSec: info.durationSec, summary: info.summary };
}

/** The format that holds a video's sound as it is, so it's copied, not re-encoded. */
const COPY_FORMAT: Record<string, string> = {
  aac: 'm4a',
  opus: 'ogg',
  mp3: 'mp3',
  flac: 'flac',
};

/**
 * A video's sound as its own file, made in the browser before anything is
 * uploaded (tools/video.md → V17: "Audio is extracted in the browser first").
 * Copied as it is when it can be; otherwise MP3 at 96 kbps, which speech
 * recognition doesn't miss. An audio file goes as it is.
 */
export async function soundOnly(file: File, ctx: ServerRunContext): Promise<File> {
  if (isAudioFile(file)) return file;
  const { probeMedia } = await import('@etb/engines/media');
  const info = await probeMedia(file);
  const track = info.audio[0];
  if (!track) throw new Error('This video has no sound, so there is nothing to transcribe.');
  const engines = await loadMediaEngines();
  const format = COPY_FORMAT[track.codec ?? ''] ?? 'mp3';
  const out = await engines.extractAudioEngine.run(
    file,
    { format, bitrate: '96', sampleRate: 'keep', track: track.number },
    {
      signal: ctx.signal,
      progress: (fraction) => {
        ctx.progress({ stage: 'Taking the sound out of the video', fraction });
      },
    },
  );
  return new File([out.blob], `sound.${out.ext}`, { type: out.blob.type });
}
