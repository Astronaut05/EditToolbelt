import { defineTool } from '../../define';

export default defineTool({
  id: 'resize-image',
  code: 'P03',
  slug: 'resize-image',
  category: 'photo',
  name: 'Resize Image',
  tagline: 'Resize to exact pixels, a percentage or the longest side, one image or a batch.',
  summary: 'Exact pixels, percent or presets',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'form',
  batch: true,
  accepts: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'],
  outputs: ['jpg', 'png', 'webp', 'avif', 'bmp'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Resize Image, Exact Pixels or Percentage | EditToolbelt',
    description:
      'Resize photos to an exact width and height, a percentage or the longest side, with presets like Full HD 1920×1080. Resize up to 50 images at once.',
    h1: 'Resize Image',
    primaryQuery: 'resize image',
    secondaryQueries: ['resize image to 1920x1080', 'resize photo in pixels', 'batch resize images'],
    howTo: [
      'Drop one image or up to 50.',
      'Pick how to resize: width and height, one side, a percentage, the longest side, or a preset such as Full HD.',
      'For width and height, pick how to fit: keep the ratio, pad to the exact size, fill and crop, or stretch.',
      'Select Resize, then download each image or all of them in one ZIP.',
    ],
    faq: [
      {
        q: 'How do I resize an image to exactly 1920 × 1080?',
        a: 'Pick Full HD, or Width and height with 1920 and 1080. If your photo isn’t 16:9, choose Pad to add bars, Fill to crop the edges, or Stretch. Keep ratio gives the largest size that fits inside 1920 × 1080.',
      },
      {
        q: 'Which resampling should I pick?',
        a: 'Lanczos, the default, keeps the most detail when shrinking photos. Bilinear is softer. Nearest keeps hard pixel edges, for pixel art and screenshots enlarged by whole numbers.',
      },
      {
        q: 'Can I make an image bigger?',
        a: 'Yes, but enlarging can’t add detail, so it looks softer, and the result says so. Upscale Image, coming soon, will add real detail with AI.',
      },
      {
        q: 'Can I resize many photos at once?',
        a: 'Yes, up to 50. Longest side is the easy way to fit a batch of mixed shapes: 2048 px makes every image 2048 px on its long side and keeps its shape.',
      },
      {
        q: 'Is transparency kept?',
        a: 'Yes, in PNG, WebP and AVIF, and edges stay clean. Padding can be white, black or none. JPG has no transparency, so transparent areas become white.',
      },
    ],
  },
  related: ['crop-image', 'compress-image', 'upscale-image'],
  willDo: [
    'Resize to exact W×H, width only, height only, a percentage or the longest side',
    'Fit a box with a padding color, fill and crop, or stretch when the ratio is unlocked',
    'Start from presets like Full HD 1920×1080, 4K 3840×2160 or Story 1080×1920',
  ],
});
