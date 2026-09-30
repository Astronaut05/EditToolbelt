import { defineTool } from '../../define';

export default defineTool({
  id: 'remove-background',
  code: 'P07',
  slug: 'remove-background',
  category: 'photo',
  name: 'Remove Background',
  tagline: 'Cut out the subject and download a transparent PNG.',
  summary: 'Transparent PNG, or a new background',
  status: 'live',
  wave: 1,
  runtime: 'hybrid',
  engines: ['image-ml', 'image-ml-server'],
  ui: 'canvas-editor',
  batch: false,
  accepts: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'image/heic',
    'image/heif',
  ],
  outputs: ['png', 'webp'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 24_000_000 } },
  cost: { kind: 'flat', credits: 2 },
  surfaces: ['web', 'mobile', 'panel', 'api'],
  seo: {
    title: 'Remove Background from Image, Free in Your Browser | EditToolbelt',
    description:
      'Cut out the subject of any photo and download a transparent PNG or WebP. Runs in your browser, so your image never leaves your device.',
    h1: 'Remove Background from Image',
    primaryQuery: 'remove background from image',
    secondaryQueries: [
      'background remover free',
      'transparent background maker',
      'remove bg no sign up',
    ],
    howTo: [
      'Drop a photo, or choose one. The AI finds the subject straight away.',
      'Keep the background transparent, or pick a color, a blur of the photo or another image.',
      'If an edge needs help, select Refine by hand and paint with Keep or Erase.',
      'Download the PNG or WebP at the photo’s full size.',
    ],
    faq: [
      {
        q: 'Is my photo uploaded?',
        a: 'No. The AI model runs in your browser, on your device. The photo never leaves it, and nothing is kept.',
      },
      {
        q: 'Why does the first run take longer?',
        a: 'The AI model downloads once, 115 MB in Quality mode or 5 MB in Light mode, and is saved on this device. After that it starts instantly, even offline.',
      },
      {
        q: 'What is Light mode?',
        a: 'A much smaller model for devices without WebGPU, or when you’d rather not download 115 MB. It finds people, products and pets well, but edges around hair and fur are rougher. Refine by hand fixes the spots it misses.',
      },
      {
        q: 'What size is the result?',
        a: 'The same size in pixels as your photo, up to 24 MP. The mask is made at the model’s size, then fitted to the photo’s edges at full resolution, so hair and fine edges stay sharp.',
      },
      {
        q: 'Can I put the subject on a new background?',
        a: 'Yes: a solid color, a blur of the original photo, or another image, which is scaled to cover the photo and centered.',
      },
    ],
  },
  related: ['resize-image', 'compress-image', 'add-text-to-image'],
  willDo: [
    'Cut out people, products, pets and cars in about 2 seconds, in your browser',
    'Keep the background transparent, or swap it for a color, a blur or another image',
    'Download a transparent PNG or WebP at full resolution',
  ],
});
