import { defineTool } from '../../define';

export default defineTool({
  id: 'upscale-video',
  code: 'V20',
  slug: 'upscale-video',
  category: 'video',
  name: 'Upscale Video',
  tagline: 'Make low-resolution video 2× or 4× larger and sharper with AI, up to 4K.',
  summary: 'AI 2× or 4×, up to 4K',
  status: 'soon',
  wave: 3,
  runtime: 'server-gpu',
  engines: ['video-ml-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMinute', credits: 10, minCredits: 10 },
  surfaces: ['web', 'panel', 'api'],
  seo: {
    title: 'AI Video Upscaler, 2× or 4× up to 4K | EditToolbelt',
    description:
      'Upscale video 2× or 4× with AI, up to 4K output, for clips up to 10 minutes. Preview 3 seconds for free before you spend credits.',
    h1: 'AI Video Upscaler',
    primaryQuery: 'ai video upscaler',
    secondaryQueries: [],
  },
  related: ['upscale-image', 'compress-video', 'video-info'],
  willDo: [
    'Enlarge video 2× or 4× with an AI model, up to 4K output',
    'Preview 3 seconds of the result for free before you use credits',
    'Take clips up to 10 minutes long, priced per minute',
  ],
});
