import { defineTool } from '../../define';

export default defineTool({
  id: 'reverse-audio',
  code: 'A15',
  slug: 'reverse-audio',
  category: 'audio',
  name: 'Reverse Audio',
  tagline: 'Play a sound backwards: reverse the whole file or only the part you select.',
  summary: 'Whole file or a selection',
  status: 'beta',
  wave: 3,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'timeline',
  batch: false,
  accepts: ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac'],
  outputs: ['wav', 'flac', 'mp3', 'm4a', 'ogg'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Reverse Audio, Whole File or a Selection | EditToolbelt',
    description:
      'Play audio backwards. Reverse a whole MP3, WAV or other file, or select a part on the waveform and reverse only that. Free, in your browser.',
    h1: 'Reverse Audio',
    primaryQuery: 'reverse audio',
    secondaryQueries: [],
    howTo: [
      'Drop an audio file: MP3, WAV, FLAC, OGG or M4A.',
      'To reverse all of it, leave the whole waveform selected. To reverse one part, drag the handles to it.',
      'Keep the file’s own format, or pick WAV, FLAC, MP3 or M4A.',
      'Press Reverse, listen to the result, and download it.',
    ],
    faq: [
      {
        q: 'Is my audio uploaded?',
        a: 'No. It is decoded, turned round and encoded again in this browser, and never leaves your device.',
      },
      {
        q: 'Does a reversed part click where it meets the rest?',
        a: 'No. The audio dips to silence for 5 ms either side of each join, too short to hear as a gap, so the jump in the waveform doesn’t click.',
      },
      {
        q: 'Does it lose quality?',
        a: 'WAV and FLAC stay lossless. MP3, M4A and OGG are encoded again at the file’s own bitrate, which is hard to hear once.',
      },
    ],
  },
  related: ['reverse-video', 'trim-audio', 'change-pitch'],
  willDo: [
    'Reverse a whole audio file so it plays backwards',
    'Select a part on the waveform and reverse only that',
    'Keep the original format, or export to another one',
  ],
});
