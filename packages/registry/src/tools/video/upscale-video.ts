import { defineTool } from '../../define';

export default defineTool({
  id: 'upscale-video',
  code: 'V20',
  slug: 'upscale-video',
  category: 'video',
  name: 'Upscale Video',
  tagline: 'Make low-resolution video 2× or 4× larger and sharper with AI, up to 4K.',
  summary: 'AI 2× or 4×, up to 4K',
  // An admin switches it on (status beta) in the server build, once Modal runs it.
  status: 'soon',
  wave: 3,
  runtime: 'server-gpu',
  engines: ['video-ml-server'],
  ui: 'form',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['mp4'],
  limits: {
    // 2× makes 4K from 1080p (4× from 960 × 540 is checked at quote time), 10 min at 30 fps.
    server: {
      free: { maxBytes: 200 * 1024 ** 2, maxDurationSec: 60, maxPixels: 1920 * 1080 },
      paid: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 10 * 60, maxPixels: 1920 * 1080 },
    },
    // The GPU function stops at 90 min; this leaves room for a cold start.
    timeoutSec: 95 * 60,
    maxConcurrent: 2,
  },
  cost: { kind: 'perMinute', credits: 10, minCredits: 10 },
  gpu: 'L4',
  surfaces: ['web', 'panel', 'api'],
  seo: {
    title: 'AI Video Upscaler, 2× or 4× up to 4K | EditToolbelt',
    description:
      'Upscale video 2× or 4× with AI, up to 4K, for clips up to 10 minutes. Real-ESRGAN for real footage or animation, with noise cleanup. MP4 with the sound.',
    h1: 'AI Video Upscaler',
    primaryQuery: 'ai video upscaler',
    secondaryQueries: ['upscale video to 4k', 'video enhancer', 'increase video resolution'],
    howTo: [
      'Drop an MP4, MOV, WebM or MKV video, up to 10 minutes.',
      'Pick 2× or 4×: the result can be up to 4K (3840 × 2160).',
      'Pick General for real footage or Animation for cartoons and anime, and how much noise to clean up.',
      'Select Upscale on our servers, then download the MP4 with the original sound.',
    ],
    faq: [
      {
        q: 'How big can the result be?',
        a: 'Up to 4K: 3840 × 2160, or 2160 × 3840 upright. So 2× takes up to 1080p and 4× up to 960 × 540. Clips can be up to 10 minutes at 30 fps, or 5 at 60.',
      },
      {
        q: 'Which model should I pick?',
        a: 'General is Real-ESRGAN’s model for real footage, with noise cleanup for grain and compression blocks. Animation is its model for anime video: flat colors and lines stay clean and steady from frame to frame.',
      },
      {
        q: 'Does it keep the sound and frame rate?',
        a: 'Yes. The sound is copied when MP4 can hold it, otherwise made AAC. The frame rate stays; a variable one from a phone becomes constant, so it stays in sync in your editor.',
      },
      {
        q: 'What does it cost?',
        a: '10 credits a minute, at least 10. Your video and the result are deleted within an hour.',
      },
    ],
  },
  related: ['upscale-image', 'compress-video', 'video-info'],
  willDo: [
    'Enlarge video 2× or 4× with an AI model, up to 4K output',
    'Pick a model for real footage or for animation, with noise cleanup',
    'Take clips up to 10 minutes long, priced per minute',
  ],
});
