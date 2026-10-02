import { defineTool } from '../../define';

export default defineTool({
  id: 'upscale-image',
  code: 'P08',
  slug: 'upscale-image',
  category: 'photo',
  name: 'Upscale Image',
  tagline: 'Make small images bigger and sharper with AI.',
  summary: 'AI 2× and 4×',
  // An admin switches it on (status beta) in the server build, once Modal runs it.
  status: 'soon',
  wave: 2,
  runtime: 'server-gpu',
  engines: ['image-ml-server'],
  ui: 'form',
  batch: false,
  accepts: ['image/png', 'image/jpeg', 'image/webp'],
  outputs: ['png', 'jpg', 'webp'],
  limits: {
    // Input pixels: the result is capped at 64 MP, so 16 MP at 2× (4 MP at 4×, checked at quote time).
    server: {
      free: { maxBytes: 25 * 1024 ** 2, maxPixels: 16_000_000 },
      paid: { maxBytes: 100 * 1024 ** 2, maxPixels: 16_000_000 },
    },
    // The GPU function stops at 15 min; this leaves room for a cold start.
    timeoutSec: 20 * 60,
    maxConcurrent: 2,
  },
  cost: { kind: 'perMegapixel', credits: 0.25, minCredits: 2 },
  gpu: 'T4',
  surfaces: ['web', 'mobile', 'panel', 'api'],
  seo: {
    title: 'Upscale Image with AI, 2× or 4× | EditToolbelt',
    description:
      'Enlarge photos and illustrations 2× or 4× with an AI model made for each, up to 64 MP. Clean up grain and JPEG noise as it goes. PNG, JPG or WebP.',
    h1: 'Upscale Image',
    primaryQuery: 'upscale image',
    secondaryQueries: ['ai image upscaler', 'increase image resolution', 'enhance photo quality'],
    howTo: [
      'Drop a PNG, JPG or WebP image.',
      'Pick 2× or 4×, and the General model for photos or Illustration for drawings and anime.',
      'Set how much noise to clean up, and the format: PNG keeps transparency.',
      'Select Upscale on our servers and download the result.',
    ],
    faq: [
      {
        q: 'How big can the result be?',
        a: 'Up to 64 megapixels, such as 8000 × 8000 px. So 4× takes images up to 4 MP, like 2000 × 2000 px, and 2× takes up to 16 MP.',
      },
      {
        q: 'Which model should I pick?',
        a: 'General suits photos, screenshots and most images. Illustration is trained on drawings and anime: flat colours and clean lines stay crisp instead of turning painterly.',
      },
      {
        q: 'What does noise cleanup do?',
        a: 'It smooths film grain, sensor noise and JPEG blocks while it enlarges. None keeps the grain as it is; High gives the cleanest, smoothest result. It applies to the General model.',
      },
      {
        q: 'Does it fix faces?',
        a: 'No. Faces get the same careful enlargement as everything else, but no face model invents new detail, so people still look like themselves.',
      },
      {
        q: 'What does it cost?',
        a: 'One credit for every 4 megapixels of the result, at least 2. A 1000 × 750 photo made 4× is 4000 × 3000, 12 MP, so 3 credits. Your file and the result are deleted within an hour.',
      },
    ],
  },
  related: ['resize-image', 'compress-image', 'remove-background'],
  willDo: [
    'Enlarge 2× or 4×, with a model for photos and one for illustrations',
    'Clean up grain and JPEG noise as it enlarges, up to 64 MP',
    'Download as PNG, JPG or WebP',
  ],
});
