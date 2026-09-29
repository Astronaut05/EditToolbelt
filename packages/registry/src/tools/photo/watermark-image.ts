import { defineTool } from '../../define';

export default defineTool({
  id: 'watermark-image',
  code: 'P11',
  slug: 'watermark-image',
  category: 'photo',
  name: 'Watermark Images',
  tagline: 'Stamp a text or logo watermark on a batch of photos, in the same spot on each.',
  summary: 'Text or logo, in batches',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['image-paint'],
  ui: 'batch',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Watermark Images, Text or Logo in Batch | EditToolbelt',
    description:
      'Add a text or logo watermark to up to 50 images at once. Set position, size as % of width, opacity, tiling and margin. It lands in the same place on each.',
    h1: 'Watermark Images',
    primaryQuery: 'watermark images',
    secondaryQueries: ['add logo to photos', 'batch watermark'],
  },
  related: ['add-text-to-image', 'resize-image', 'compress-image'],
  willDo: [
    'Watermark a batch with text or a logo image',
    'Place it on a 9-point grid with offset, sized as % of image width, or tile it',
    'Keep the same relative placement across images of different sizes',
  ],
});
