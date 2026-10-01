import { defineTool } from '../../define';

export default defineTool({
  id: 'split-image',
  code: 'P14',
  slug: 'split-image',
  category: 'photo',
  name: 'Split Image into Grid',
  tagline: 'Cut one image into equal tiles for carousels, panoramas and 3×3 profile grids.',
  summary: 'Rows × columns, carousels and 3×3 grids',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'form',
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
  outputs: ['zip'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Split Image into Grid, Carousel and 3×3 Tiles | EditToolbelt',
    description:
      'Split a photo into rows and columns for Instagram carousels, panorama posts and 3×3 profile grids. Use a preset or your own grid, free in your browser.',
    h1: 'Split Image into Grid',
    primaryQuery: 'split image into grid',
    secondaryQueries: ['instagram grid maker', 'panorama carousel splitter'],
    howTo: [
      'Drop an image, or choose one from your device.',
      'Pick a grid: 3 × 3 for a profile, 1 × 3 or 1 × 10 for a carousel, or your own rows and columns.',
      'Choose posting order for a profile grid, so you post tile 1 first and the picture reads right.',
      'Split it and download the ZIP of tiles, named in order.',
    ],
    faq: [
      {
        q: 'How do I make a 3×3 grid for my profile?',
        a: 'Choose the 3 × 3 profile grid and posting order. Post the tiles in the order of their numbers: tile 1 is the bottom-right piece, so after the ninth post the whole picture shows on your profile.',
      },
      {
        q: 'What are feed gaps?',
        a: 'Profile grids show a thin line between posts. With feed gaps on, the same thin strip is left out between tiles, so lines and horizons stay straight across the gaps instead of looking shifted.',
      },
      {
        q: 'What if the image does not divide evenly?',
        a: 'Equal size keeps every tile the same and trims the few leftover pixels evenly from the edges. Every pixel keeps the whole image, and some tiles end up 1 px wider or taller.',
      },
      {
        q: 'Does it lose quality?',
        a: 'Tiles are cut pixel for pixel. A JPG is saved again once at the quality you choose, and PNG and WebP lossless keep every pixel exact.',
      },
    ],
  },
  related: ['social-media-image-resizer', 'crop-image', 'collage-maker'],
  willDo: [
    'Split into any rows × cols grid, or use the 1×2, 1×3, 1×10 carousel and 3×3 presets',
    'Choose how gaps are handled and the order the tiles are named in',
    'Make a panorama carousel or a 3×3 profile grid from one image',
  ],
});
