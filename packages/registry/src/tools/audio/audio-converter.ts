import { defineTool } from '../../define';

export default defineTool({
  id: 'audio-converter',
  code: 'A01',
  slug: 'audio-converter',
  category: 'audio',
  name: 'Audio Converter',
  tagline: 'Convert audio to MP3, WAV, FLAC, OGG or M4A, or change the sample rate to 48 kHz.',
  summary: 'MP3, WAV, FLAC, M4A, and 44.1 to 48 kHz',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'form',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Audio Converter, Change Format or Sample Rate | EditToolbelt',
    description:
      'Convert between MP3, WAV, FLAC, OGG and M4A, or change sample rate from 44.1 to 48 kHz for video. Convert a batch at once, free in your browser.',
    h1: 'Audio Converter',
    primaryQuery: 'audio converter',
    secondaryQueries: ['wav to mp3', 'convert 44.1 to 48khz', 'm4a to mp3'],
  },
  related: ['extract-audio', 'trim-audio', 'normalize-audio'],
  willDo: [
    'Convert one file or a batch between MP3, WAV, FLAC, OGG/Opus and M4A/AAC',
    'Change sample rate to 44.1, 48 or 96 kHz, bit depth to 16 or 24-bit, and channels to mono or stereo',
    'Pick MP3 CBR 128, 192, 256 or 320 kbps, or VBR V0-V4, and keep your tags',
  ],
});
