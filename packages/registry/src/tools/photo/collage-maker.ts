import { defineTool } from '../../define';

export default defineTool({
  id: 'collage-maker',
  code: 'P16',
  slug: 'collage-maker',
  category: 'photo',
  name: 'Collage Maker',
  tagline: 'Arrange 2-9 photos in a layout template and export them as one image.',
  summary: '2-9 photos in a layout template',
  status: 'beta',
  wave: 3,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'form',
  batch: true,
  accepts: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/bmp',
    'image/heic',
    'image/heif',
  ],
  outputs: ['jpg', 'png', 'webp'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Photo Collage Maker, Up to 9 Photos | EditToolbelt',
    description:
      'Put 2-9 photos into a collage template. Set spacing, corner radius and background, then export at a preset output size. Free, in your browser.',
    h1: 'Photo Collage Maker',
    primaryQuery: 'photo collage maker',
    secondaryQueries: [],
    howTo: [
      'Drop 2 to 9 photos: JPG, PNG, WebP, GIF or AVIF.',
      'Drag them into order. The first one is the big photo in the Big left and Big top layouts.',
      'Pick a layout and an output size, then set the spacing, corner radius and background colour.',
      'Press Make collage and download it as JPG, PNG or WebP.',
    ],
    faq: [
      {
        q: 'Are my photos uploaded?',
        a: 'No. The collage is made in this browser, and the photos never leave your device.',
      },
      {
        q: 'What happens to photos that don’t match their box?',
        a: 'Each photo fills its box and is cropped evenly from the sides or the top and bottom, so nothing is stretched. Put a photo in a box of a similar shape to keep more of it.',
      },
      {
        q: 'How big is the collage?',
        a: 'Square is 2160 × 2160 px, Portrait 4:5 is 2160 × 2700 px, Story 9:16 is 2160 × 3840 px, Landscape 16:9 is 3840 × 2160 px, and A4 is 2480 × 3508 px (300 dpi). The spacing and corner radius are pixels at that size.',
      },
    ],
  },
  related: ['split-image', 'social-media-image-resizer', 'images-to-pdf'],
  willDo: [
    'Place 2-9 images into a layout template',
    'Set spacing, corner radius and background',
    'Export at an output size preset',
  ],
});
