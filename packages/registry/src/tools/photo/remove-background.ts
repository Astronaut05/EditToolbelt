import { defineTool } from '../../define';

export default defineTool({
  id: 'remove-background',
  code: 'P07',
  slug: 'remove-background',
  category: 'photo',
  name: 'Remove Background',
  tagline: 'Cut out the subject and download a transparent PNG.',
  summary: 'Transparent PNG, or a new background',
  status: 'soon',
  wave: 1,
  runtime: 'hybrid',
  engines: ['image-ml', 'image-ml-server'],
  ui: 'canvas-editor',
  batch: false,
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
  },
  related: ['resize-image', 'compress-image', 'add-text-to-image'],
  willDo: [
    'Cut out people, products, pets and cars in about 2 seconds, in your browser',
    'Keep the background transparent, or swap it for a color, a blur or another image',
    'Download a transparent PNG or WebP at full resolution',
  ],
});
