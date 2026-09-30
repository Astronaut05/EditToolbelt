import { codecLabel, MediaInputError, openInput } from '../video/media';
import { AUDIO_LIMITS } from './convert';

/** What the audio tools read from a file as it arrives. */
export interface AudioProbe {
  durationSec: number;
  codec: string | null;
  channels: number;
  sampleRate: number;
  canDecode: boolean;
  /** "MP3 · 44.1 kHz · stereo · 3:12" */
  summary: string;
}

const CHANNELS: Record<number, string> = { 1: 'mono', 2: 'stereo' };

const PCM: Record<string, string> = {
  'pcm-u8': 'PCM 8-bit',
  'pcm-s16': 'PCM 16-bit',
  'pcm-s16be': 'PCM 16-bit',
  'pcm-s24': 'PCM 24-bit',
  'pcm-s24be': 'PCM 24-bit',
  'pcm-s32': 'PCM 32-bit',
  'pcm-s32be': 'PCM 32-bit',
  'pcm-f32': 'PCM 32-bit float',
  'pcm-f32be': 'PCM 32-bit float',
  'pcm-f64': 'PCM 64-bit float',
  'pcm-f64be': 'PCM 64-bit float',
};

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m >= 60
    ? `${String(Math.floor(m / 60))}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m)}:${String(s).padStart(2, '0')}`;
}

/** Reads the first audio track: length, codec, rate, channels, within the browser limits. */
export async function probeAudio(file: Blob): Promise<AudioProbe> {
  if (file.size > AUDIO_LIMITS.maxBytes) {
    throw new MediaInputError('This file is over 1 GB, the browser limit for audio.');
  }
  const input = openInput(file);
  try {
    if (!(await input.canRead())) {
      throw new MediaInputError(
        'This isn’t an audio file this tool can read. Try MP3, WAV, FLAC, OGG or M4A.',
      );
    }
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new MediaInputError('This file has no audio in it.');
    const durationSec = await input.computeDuration();
    if (durationSec > AUDIO_LIMITS.maxSeconds) {
      throw new MediaInputError(
        `This file is ${(durationSec / 3600).toFixed(1)} h long; the browser limit is 4 h.`,
      );
    }
    const codec = await track.getCodec();
    const channels = await track.getNumberOfChannels();
    const sampleRate = await track.getSampleRate();
    return {
      durationSec,
      codec,
      channels,
      sampleRate,
      canDecode: await track.canDecode(),
      summary: [
        (codec && PCM[codec]) ?? codecLabel(codec),
        `${String(sampleRate / 1000)} kHz`,
        CHANNELS[channels] ?? `${String(channels)} channels`,
        clock(durationSec),
      ].join(' · '),
    };
  } finally {
    input.dispose();
  }
}
