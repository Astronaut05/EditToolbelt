import { defineTool } from '../../define';

export default defineTool({
  id: 'trim-audio',
  code: 'A02',
  slug: 'trim-audio',
  category: 'audio',
  name: 'Trim Audio',
  tagline: 'Cut the start, the end or any range out of an audio file, with fades at the edges.',
  summary: 'Cut a range, fade the edges',
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
      'Cut the start and end of an MP3, WAV or FLAC, or remove a range from the middle. Sample-accurate cuts, and WAV or FLAC stay lossless. Free in your browser.',
    h1: 'Trim Audio',
    primaryQuery: 'trim audio',
    secondaryQueries: ['cut mp3', 'audio cutter'],
    howTo: [
      'Drop an audio file: MP3, WAV, FLAC, OGG or M4A.',
      'Drag In and Out on the waveform, or type the times. The arrow keys move 1 ms, Shift and an arrow 1 s.',
      'Keep the selection, or remove it and join what’s either side. Add a fade in or out if you like.',
      'Select Trim, then download the file.',
    ],
    faq: [
      {
        q: 'Does trimming an MP3 lower its quality?',
        a: 'Not without fades: the MP3 frames are copied as they are, so the cut lands on the nearest frame, about 26 ms. Fades, or removing a range from the middle, re-encode it at the same bitrate.',
      },
      {
        q: 'Is a WAV or FLAC cut exact?',
        a: 'Yes, to the sample, and the file stays lossless: nothing is compressed on the way.',
      },
      {
        q: 'Will the cut click?',
        a: 'Removing a range adds a 5 ms fade on each side of the join so it doesn’t. For a softer start or end, pick a fade in or out.',
      },
      {
        q: 'Is my audio uploaded?',
        a: 'No. It is cut in your browser, up to 1 GB and 4 hours.',
      },
    ],
  },
  related: ['fade-audio', 'remove-silence', 'audio-converter'],
  willDo: [
    'Keep or remove a range on the waveform, cut to the sample for WAV and FLAC',
    'Copy MP3, AAC and Opus frames without re-encoding when there are no fades',
    'Fade in and out, with a 5 ms fade on each side of a join so it doesn’t click',
  ],
});
