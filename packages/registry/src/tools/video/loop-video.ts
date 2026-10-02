import { defineTool } from '../../define';

export default defineTool({
  id: 'loop-video',
  code: 'V19',
  slug: 'loop-video',
  category: 'video',
  name: 'Loop Video',
  tagline: 'Repeat a clip a set number of times or up to a target length, or make a boomerang.',
  summary: 'Repeat N times, to a length, or boomerang',
  status: 'beta',
  wave: 3,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['mp4', 'mov', 'webm', 'mkv'],
  limits: { client: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Loop Video, Repeat a Clip or Make a Boomerang | EditToolbelt',
    description:
      'Repeat a video N times or until it reaches a target length, or play it forward then backward as a boomerang. Joins without re-encoding when it can.',
    h1: 'Loop Video',
    primaryQuery: 'loop video',
    secondaryQueries: [],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'Repeat it a number of times, from 2 to 50, or up to a length in seconds.',
      'Turn on Boomerang to play it forwards, then backwards, as one loop.',
      'Press Loop, watch the result and download it, in the same format as the clip.',
    ],
    faq: [
      {
        q: 'Is my video uploaded?',
        a: 'No. It is looped in this browser and never leaves your device.',
      },
      {
        q: 'Does looping lose quality?',
        a: 'Not when the copies are joined as they are: each one is copied packet for packet, instantly, with nothing encoded again. A boomerang is encoded again at high quality, since it plays frames backwards. So is a length that ends partway through a copy of a clip whose frames depend on later ones (B-frames).',
      },
      {
        q: 'How long can the result be?',
        a: 'Up to 60 minutes and 2 GB, the limits for video in a browser. For a long loop of a large clip, repeat it fewer times or compress it first.',
      },
    ],
  },
  related: ['reverse-video', 'gif-to-mp4', 'video-to-gif'],
  willDo: [
    'Repeat a clip N times, or until it reaches a target duration',
    'Make a boomerang that plays forward, then backward',
    'Join the copies without re-encoding when possible, so it is fast',
  ],
});
