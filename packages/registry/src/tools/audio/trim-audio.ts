import { defineTool } from '../../define';

export default defineTool({
  id: 'trim-audio',
  code: 'A02',
  slug: 'trim-audio',
  category: 'audio',
  name: 'Trim Audio',
  tagline: 'Cut the start, the end or any ranges out of an audio file, with fades at the edges.',
  summary: 'Cut ranges, fade the edges',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'timeline',
  batch: false,
  accepts: ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac'],
  outputs: ['mp3', 'wav', 'flac', 'ogg', 'm4a'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Trim Audio, Cut MP3 or WAV to the Millisecond | EditToolbelt',
    description:
      'Cut an MP3, WAV or FLAC: trim the ends, or keep or remove several ranges and join them. WAV and FLAC are cut to the sample, lossless. Free in your browser.',
    h1: 'Trim Audio',
    primaryQuery: 'trim audio',
    secondaryQueries: ['cut mp3', 'audio cutter'],
    howTo: [
      'Drop an audio file: MP3, WAV, FLAC, OGG or M4A.',
      'Drag In and Out on the waveform, or type the times. The arrow keys move 1 ms, Shift and an arrow 1 s.',
      'Need more than one part? Select Add range. Keep the ranges, or remove them and join what’s left. Add a fade in or out if you like.',
      'Select Trim, then download the file.',
    ],
    faq: [
      {
        q: 'Does trimming an MP3 lower its quality?',
        a: 'Not when you keep one range without fades: the MP3 frames are copied as they are, so the cut lands on the nearest frame, about 26 ms. Fades, or joining parts, re-encode it at the same bitrate.',
      },
      {
        q: 'Is a WAV or FLAC cut exact?',
        a: 'Yes, to the sample, and the file stays lossless: nothing is compressed on the way.',
      },
      {
        q: 'Will the cut click?',
        a: 'No. Where two parts meet, they crossfade over 10 ms: short enough to hear as a cut, long enough not to click. For a softer start or end, pick a fade in or out.',
      },
      {
        q: 'Is my audio uploaded?',
        a: 'No. It is cut in your browser, up to 1 GB and 4 hours.',
      },
    ],
  },
  related: ['fade-audio', 'remove-silence', 'audio-converter'],
  willDo: [
    'Keep or remove one or more ranges on the waveform, cut to the sample for WAV and FLAC',
    'Copy MP3, AAC and Opus frames without re-encoding when there are no fades',
    'Fade in and out, with a 10 ms crossfade at each join so it doesn’t click',
  ],
});
