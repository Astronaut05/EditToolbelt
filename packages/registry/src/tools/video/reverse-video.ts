import { defineTool } from '../../define';

export default defineTool({
  id: 'reverse-video',
  code: 'V18',
  slug: 'reverse-video',
  category: 'video',
  name: 'Reverse Video',
  tagline: 'Play a clip backwards, with the sound reversed too or left out.',
  summary: 'Play it backwards, with or without sound',
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
    title: 'Reverse Video, Play a Clip Backwards | EditToolbelt',
    description:
      'Play a video backwards, with the audio reversed too or removed. It runs in your browser in chunks to keep memory in check, and warns you before long clips.',
    h1: 'Reverse Video',
    primaryQuery: 'reverse video',
    secondaryQueries: [],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'Pick whether the sound plays backwards with the picture or is left out.',
      'Press Reverse. The clip is read from its end a few frames at a time, then encoded again.',
      'Watch the result and download it, in the same format as the clip.',
    ],
    faq: [
      {
        q: 'Is my video uploaded?',
        a: 'No. It is decoded and encoded again in this browser and never leaves your device.',
      },
      {
        q: 'Why does it take longer than other video tools?',
        a: 'Video can only be decoded forwards, so the clip is read in short stretches from the end, and each stretch is decoded from the keyframe before it. A clip of a few minutes takes about as long as it plays; a long one, longer. The page warns you before a clip over 5 minutes.',
      },
      {
        q: 'Does the result keep the quality?',
        a: 'It is encoded again at high quality, in the same format as the clip. Every frame is kept, each for as long as it showed, so the length and frame rate don’t change.',
      },
    ],
  },
  related: ['loop-video', 'video-speed', 'video-to-gif'],
  willDo: [
    'Reverse the picture, with the audio reversed too or left out',
    'Work through the clip in chunks in your browser to keep memory use down',
    'Warn you before starting on a long clip',
  ],
});
