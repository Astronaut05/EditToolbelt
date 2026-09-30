import { defineTool } from '../../define';

export default defineTool({
  id: 'video-converter',
  code: 'V03',
  slug: 'video-converter',
  category: 'video',
  name: 'Video Converter',
  tagline: 'Change MOV, MKV, WebM or AVI into MP4, WebM, MOV or MKV, remuxing when it can.',
  summary: 'Remux when it can, re-encode when it must',
  status: 'live',
  wave: 1,
  runtime: 'hybrid',
  engines: ['video-webcodecs', 'video-ffmpeg-server'],
  ui: 'form',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['mp4', 'webm', 'mov', 'mkv'],
  limits: { client: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 } },
  cost: { kind: 'perMinute', credits: 1, minCredits: 1 },
  surfaces: ['web', 'mobile', 'api'],
  seo: {
    title: 'Video Converter, MOV, MKV and WebM to MP4 | EditToolbelt',
    description:
      'Convert MOV, MKV, WebM and AVI to MP4, WebM, MOV or MKV. When the codecs already fit the new container, it remuxes instantly with no quality loss.',
    h1: 'Video Converter',
    primaryQuery: 'video converter',
    secondaryQueries: ['mov to mp4', 'mkv to mp4', 'webm to mp4'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'Pick the format. Keep quality remuxes whenever the tracks already fit it.',
      'To re-encode anyway, pick Re-encode and a codec.',
      'Select Convert. The result says whether it remuxed or re-encoded.',
    ],
    faq: [
      {
        q: 'What is remuxing?',
        a: 'Moving the video and audio into a new container as they are, with nothing re-encoded. It is instant and loses nothing. It works when the codecs inside suit the new format, such as H.264 from a MOV into an MP4.',
      },
      {
        q: 'Why does MKV (VP9) to MP4 re-encode?',
        a: 'An MP4 can hold VP9, but iPhones, QuickTime and editing apps won’t play it there. The video is re-encoded to H.264 so the MP4 plays everywhere.',
      },
      {
        q: 'Can it convert AVI or ProRes?',
        a: 'Not in the browser yet. AVI and ProRes need our server converter, which comes later; the page says so if you drop one.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. It is converted in your browser, up to 2 GB and 60 minutes.',
      },
    ],
  },
  related: ['compress-video', 'video-info', 'extract-audio'],
  willDo: [
    'Convert MOV, MKV, WebM and MP4 to MP4, WebM, MOV or MKV, with AVI and ProRes on our servers later',
    "Remux instantly when the codecs already fit the new container, and re-encode only when they don't",
    'Choose the codec where it matters, or keep quality and remux whenever possible',
  ],
});
