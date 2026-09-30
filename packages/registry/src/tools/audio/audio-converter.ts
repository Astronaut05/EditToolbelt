import { defineTool } from '../../define';

export default defineTool({
  id: 'audio-converter',
  code: 'A01',
  slug: 'audio-converter',
  category: 'audio',
  name: 'Audio Converter',
  tagline: 'Convert audio to MP3, WAV, FLAC, OGG or M4A, or change the sample rate to 48 kHz.',
  summary: 'MP3, WAV, FLAC, M4A, and 44.1 to 48 kHz',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: true,
  accepts: [
    '.mp3',
    '.wav',
    '.flac',
    '.ogg',
    '.oga',
    '.opus',
    '.m4a',
    '.aac',
    '.mp4',
    '.mov',
    '.webm',
  ],
  outputs: ['mp3', 'wav', 'flac', 'ogg', 'm4a'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Audio Converter, Change Format or Sample Rate | EditToolbelt',
    description:
      'Convert between MP3, WAV, FLAC, OGG and M4A, or change sample rate from 44.1 to 48 kHz for video. Convert a batch at once, free in your browser.',
    h1: 'Audio Converter',
    primaryQuery: 'audio converter',
    secondaryQueries: ['wav to mp3', 'convert 44.1 to 48khz', 'm4a to mp3'],
    howTo: [
      'Drop one audio file or a batch: MP3, WAV, FLAC, OGG, Opus, M4A or AAC. Videos work too; their sound is converted.',
      'Pick the format, and a bitrate for MP3, M4A or OGG.',
      'Change the sample rate (48 kHz for video), the bit depth for WAV, or the channels, or keep them.',
      'Select Convert, then download each file or all of them in one ZIP.',
    ],
    faq: [
      {
        q: 'How do I convert 44.1 kHz audio to 48 kHz for video?',
        a: 'Pick 48 kHz under Sample rate. The length and the pitch stay exactly the same; only the number of samples per second changes, which is what video timelines expect.',
      },
      {
        q: 'Which format should I pick?',
        a: 'MP3 plays everywhere. WAV is for editing and hardware. FLAC is lossless at half the size of WAV. OGG (Opus) is small and suits games and the web. M4A (AAC) suits Apple devices.',
      },
      {
        q: 'Is the audio re-encoded if it is already in that format?',
        a: 'Not when nothing else changes: it is copied as it is. Changing the bitrate, sample rate or channels re-encodes it.',
      },
      {
        q: 'Can I pick VBR for MP3?',
        a: 'Not yet: MP3 is written at a constant bitrate from 128 to 320 kbps. 192 kbps CBR sounds like V2 VBR for most material.',
      },
      {
        q: 'Are my files uploaded?',
        a: 'No. Everything is converted in your browser.',
      },
    ],
  },
  related: ['extract-audio', 'trim-audio', 'normalize-audio'],
  willDo: [
    'Convert one file or a batch between MP3, WAV, FLAC, OGG/Opus and M4A/AAC',
    'Change sample rate to 44.1, 48 or 96 kHz, WAV bit depth to 16 or 24-bit, and channels to mono or stereo',
    'Pick MP3 at 128, 192, 256 or 320 kbps, and keep your tags',
  ],
});
