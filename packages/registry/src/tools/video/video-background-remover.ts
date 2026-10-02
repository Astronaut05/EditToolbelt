import { defineTool } from '../../define';

export default defineTool({
  id: 'video-background-remover',
  code: 'V21',
  slug: 'video-background-remover',
  category: 'video',
  name: 'Video Background Remover',
  tagline: 'Cut people and objects out of video, onto transparency or a green screen.',
  summary: 'Transparent or green screen output',
  // An admin switches it on (status beta) in the server build, once Modal runs it.
  status: 'soon',
  wave: 3,
  runtime: 'server-gpu',
  engines: ['video-ml-server'],
  ui: 'form',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['mov', 'webm', 'mp4'],
  limits: {
    // Up to 4K, 10 min at 30 fps (ProRes is capped by its size at quote time).
    server: {
      free: { maxBytes: 200 * 1024 ** 2, maxDurationSec: 60, maxPixels: 3840 * 2160 },
      paid: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 10 * 60, maxPixels: 3840 * 2160 },
    },
    // The GPU function stops at 90 min; this leaves room for a cold start.
    timeoutSec: 95 * 60,
    maxConcurrent: 2,
  },
  cost: { kind: 'perMinute', credits: 8, minCredits: 8 },
  gpu: 'L4',
  surfaces: ['web', 'api'],
  seo: {
    title: 'Remove Video Background, Export with Alpha | EditToolbelt',
    description:
      'Separate people and objects from the background with AI. Export with transparency as ProRes 4444 or WebM with alpha, or on a green screen or solid color.',
    h1: 'Remove Video Background',
    primaryQuery: 'remove video background',
    secondaryQueries: [
      'video background remover',
      'transparent video',
      'green screen video online',
    ],
    howTo: [
      'Drop an MP4, MOV, WebM or MKV video, up to 10 minutes.',
      'Pick the output: ProRes 4444 or WebM with transparency, or the subject on green or a color.',
      'Select Remove background on our servers, then download the result with the original sound.',
    ],
    faq: [
      {
        q: 'Which format should I pick?',
        a: 'ProRes 4444 MOV for Premiere Pro, Final Cut and DaVinci Resolve: it keeps the transparency, but it is big, about 3 GB a minute at 1080p. WebM with alpha is small and plays with transparency in Chrome and Firefox. Green screen MP4 works anywhere with a chroma key.',
      },
      {
        q: 'How does it find the subject?',
        a: 'BiRefNet, an open model released under the MIT license, finds the subject in every frame. Where the picture holds still, the edges are steadied from frame to frame so they don’t flicker.',
      },
      {
        q: 'What works best?',
        a: 'One clear subject, such as a person, a pet or a product, that stands out from the background. Fine hair, motion blur and see-through objects are the hardest.',
      },
      {
        q: 'What does it cost?',
        a: '8 credits a minute, at least 8, for clips up to 10 minutes and 4K. Your video and the result are deleted within an hour.',
      },
    ],
  },
  related: ['remove-background', 'trim-video', 'video-converter'],
  willDo: [
    'Cut out people and objects from each frame with an AI matting model',
    'Export with transparency as ProRes 4444 or WebM with alpha',
    'Place the subject on a green screen or a solid color instead',
  ],
});
