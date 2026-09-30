import { defineTool } from '../../define';

export default defineTool({
  id: 'rotate-image',
  code: 'P04',
  slug: 'rotate-image',
  category: 'photo',
  name: 'Rotate & Flip Image',
  tagline: 'Rotate by 90° or any angle, straighten a tilted photo, or mirror it.',
  summary: '90°, free angle, mirror',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'canvas-editor',
  batch: true,
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
  outputs: ['jpg', 'png', 'webp', 'avif', 'bmp'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Rotate Image, Flip, Mirror or Straighten | EditToolbelt',
    description:
      'Rotate photos 90°, 180° or 270°, straighten them from -45° to 45° in 0.1° steps, or flip them horizontally or vertically. Free, in your browser.',
    h1: 'Rotate Image',
    primaryQuery: 'rotate image',
    secondaryQueries: ['flip image', 'mirror image online', 'straighten photo'],
    howTo: [
      'Drop an image, or several to rotate them all by 90° at once.',
      'Rotate left or right, flip, or pick Straighten and drag the angle until the grid lines up with the horizon.',
      'Under Corners, choose Auto-crop to trim the tilted corners, or Expand canvas to keep every pixel.',
      'Select Save image, then download it.',
    ],
    faq: [
      {
        q: 'Does rotating by 90° lose quality?',
        a: 'The pixels are moved, not recalculated, so nothing is lost there. A JPG is saved again afterwards, at quality 95 by default, which you can raise to 100. PNG stays lossless.',
      },
      {
        q: 'How do I straighten a crooked photo?',
        a: 'Pick Straighten, then drag the angle (0.1° steps, up to 45° either way) until the grid runs along the horizon or a wall. Auto-crop then trims the corners so nothing shows behind the photo.',
      },
      {
        q: 'What is the difference between flipping and rotating?',
        a: 'Rotating turns the picture; flipping mirrors it, like a reflection. Flip horizontal swaps left and right, flip vertical swaps top and bottom.',
      },
      {
        q: 'Can I rotate many images at once?',
        a: 'Yes, up to 50 by 90°, 180° or 270°, with an optional flip. Download them one by one or as a ZIP.',
      },
      {
        q: 'Is my photo uploaded?',
        a: 'No. Everything runs in your browser. The GPS location is removed by default and camera details are kept.',
      },
    ],
  },
  related: ['crop-image', 'photo-editor', 'resize-image'],
  willDo: [
    'Rotate 90°, 180° or 270°, and flip horizontally or vertically',
    'Straighten from -45° to 45° in 0.1° steps, with auto-crop or an expanded canvas',
    'Rotate a batch of images by 90° in one go',
  ],
});
