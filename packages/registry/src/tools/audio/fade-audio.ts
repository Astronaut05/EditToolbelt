import { defineTool } from '../../define';

export default defineTool({
  id: 'fade-audio',
  code: 'A07',
  slug: 'fade-audio',
  category: 'audio',
  name: 'Fade In / Fade Out',
  tagline: 'Add a fade in or fade out with a linear, exponential, logarithmic or S-curve shape.',
  summary: 'Set the length, pick one of 4 curves',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'form',
  batch: false,
  accepts: ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac'],
  outputs: ['wav', 'flac', 'mp3', 'm4a', 'ogg'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Fade In Fade Out Audio, Choose from 4 Curves | EditToolbelt',
    description:
      'Add a fade in or fade out to an MP3, WAV or other audio file. Set each length, pick a linear, exponential, logarithmic or S-curve, and preview it first.',
    h1: 'Fade In Fade Out Audio',
    primaryQuery: 'fade in fade out audio',
    secondaryQueries: ['add fade to mp3'],
    howTo: [
      'Drop an audio file: MP3, WAV, FLAC, OGG or M4A.',
      'Set how long the fade in and the fade out last, in seconds. Set one to 0 to leave that end as it is.',
      'Pick a curve for each: linear, exponential, logarithmic or S-curve.',
      'Add the fades, play the result, and download it in the same format, or another.',
    ],
    faq: [
      {
        q: 'Which curve should I use?',
        a: 'Linear is the plain choice. Exponential starts slowly and suits a fade in under speech or a slow build. Logarithmic drops away fast at first and suits a fade out at the end of music, as it sounds even to the ear. S-curve eases in and out, the smoothest for crossfades and loops.',
      },
      {
        q: 'What exactly does each curve do?',
        a: 'Through the fade, from 0 to 1: linear is x; exponential is (e^4x − 1) / (e^4 − 1), 12% of full volume halfway; logarithmic is its inverse, 83% halfway; S-curve is (1 − cos πx) / 2, 50% halfway.',
      },
      {
        q: 'Does it lower the quality?',
        a: 'WAV and FLAC stay lossless. MP3, M4A and OGG are encoded again at their own bitrate, which is hard to hear at 192 kbps and above. Choose WAV to avoid it.',
      },
    ],
  },
  related: ['trim-audio', 'merge-audio', 'normalize-audio'],
  willDo: [
    'Set how long the fade in and the fade out last',
    'Pick a curve for each: linear, exponential, logarithmic or S-curve',
    'Preview the fades before you download',
  ],
});
