import { defineTool } from '../../define';

export default defineTool({
  id: 'watermark-image',
  code: 'P11',
  slug: 'watermark-image',
  category: 'photo',
  name: 'Watermark Images',
  tagline: 'Stamp a text or logo watermark on a batch of photos, in the same spot on each.',
  summary: 'Text or logo, in batches',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['image-paint'],
  ui: 'form',
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
  outputs: ['jpg', 'png', 'webp', 'avif'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Watermark Images, Text or Logo in Batch | EditToolbelt',
    description:
      'Add a text or logo watermark to up to 50 images at once. Set position, size as % of width, opacity, tiling and margin. It lands in the same place on each.',
    h1: 'Watermark Images',
    primaryQuery: 'watermark images',
    secondaryQueries: ['add logo to photos', 'batch watermark'],
    howTo: [
      'Drop up to 50 photos.',
      'Type the text and pick its colour, or choose your logo (a PNG keeps it see-through).',
      'Pick its spot on the grid, its size as % of each photo’s width, and its opacity, or tile it over the whole photo.',
      'Add the watermark and download the photos one by one or as a ZIP.',
    ],
    faq: [
      {
        q: 'Will it look the same on photos of different sizes?',
        a: 'Yes. Size, margin and offset are shares of each photo’s width, so a 15% logo bottom right takes the same part of a 6000 px photo as of a 1080 px one.',
      },
      {
        q: 'Which logo files work?',
        a: 'PNG, WebP or JPG, up to 20 MB. A PNG or WebP with a transparent background keeps only the logo itself on the photo.',
      },
      {
        q: 'Are my photos uploaded?',
        a: 'No. The photos and the logo are read and watermarked in this browser and never leave your device.',
      },
    ],
  },
  related: ['add-text-to-image', 'resize-image', 'compress-image'],
  willDo: [
    'Watermark a batch with text or a logo image',
    'Place it on a 9-point grid with offset, sized as % of image width, or tile it',
    'Keep the same relative placement across images of different sizes',
  ],
});
