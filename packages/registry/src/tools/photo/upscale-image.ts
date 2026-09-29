import { defineTool } from '../../define';

export default defineTool({
  id: 'upscale-image',
  code: 'P08',
  slug: 'upscale-image',
  category: 'photo',
  name: 'Upscale Image',
  tagline: 'Make small images bigger and sharper with AI.',
  summary: 'AI 2× and 4×',
  status: 'soon',
  wave: 2,
  runtime: 'server-gpu',
  engines: ['image-ml-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMegapixel', credits: 0.25, minCredits: 2 },
  surfaces: ['web', 'mobile', 'panel', 'api'],
  seo: {
    title: 'Upscale Image with AI, 2× or 4× | EditToolbelt',
    description:
      'Enlarge photos and illustrations 2× or 4× with an AI model made for each. Preview a crop of the result for free before you use credits.',
    h1: 'Upscale Image',
    primaryQuery: 'upscale image',
    secondaryQueries: ['ai image upscaler', 'increase image resolution', 'enhance photo quality'],
  },
  related: ['resize-image', 'compress-image', 'remove-background'],
  willDo: [
    'Enlarge 2× or 4×, with a model for photos and one for illustrations',
    'Preview a crop of the result for free before you use credits',
    'Download as PNG, JPG or WebP',
  ],
});
