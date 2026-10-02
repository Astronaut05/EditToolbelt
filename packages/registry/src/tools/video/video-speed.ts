import { defineTool } from '../../define';

export default defineTool({
  id: 'video-speed',
  code: 'V13',
  slug: 'video-speed',
  category: 'video',
  name: 'Change Video Speed',
  tagline: 'Speed up or slow down a video from 0.25× to 4×, with the audio pitch kept natural.',
  summary: '0.25× to 4×, audio pitch preserved',
  status: 'beta',
  wave: 2,
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
    title: 'Speed Up Video, or Slow It Down to 0.25× | EditToolbelt',
    description:
      'Speed up or slow down a video from 0.25× to 4×, or enter a custom speed. Keep the audio pitch, let it shift, or mute the sound. Free in your browser.',
    h1: 'Speed Up Video',
    primaryQuery: 'speed up video',
    secondaryQueries: ['slow down video', 'change video speed'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'Pick a speed from 0.25× to 4×, or type your own.',
      'Keep the sound’s pitch, let it shift with the speed like tape, or mute it.',
      'Keep every frame (instant and lossless) or keep the frame rate (re-encoded), and change the speed.',
    ],
    faq: [
      {
        q: 'What is the difference between keeping every frame and keeping the frame rate?',
        a: 'Keeping every frame copies each one as it is with a new time: instant and lossless, and the frame rate scales with the speed (30 fps at 2× becomes 60 fps). Keeping the frame rate redraws the video at its own rate, dropping frames to speed up or repeating them to slow down, and re-encodes it.',
      },
      {
        q: 'Does the sound go high-pitched?',
        a: 'Not with Keep pitch: the sound is time-stretched so voices and music stay at their own pitch. Shift pitch plays it faster or slower as it is, like tape. Mute leaves it out.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. It is changed in this browser and never leaves your device.',
      },
    ],
  },
  related: ['trim-video', 'reverse-video', 'change-pitch'],
  willDo: [
    'Set any speed from 0.25× to 4×, or enter a custom value',
    'Keep the audio pitch unchanged, let it shift with the speed, or mute the sound',
    'Process the video in your browser, so it is never uploaded',
  ],
});
