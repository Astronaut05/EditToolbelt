import { defineTool } from '../../define';

export default defineTool({
  id: 'crop-image',
  code: 'P02',
  slug: 'crop-image',
  category: 'photo',
  name: 'Crop Image',
  tagline: 'Crop to a ratio or an exact pixel size, and see the output size as you drag.',
  summary: 'Free, ratio presets or exact px',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'canvas-editor',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Crop Image, Any Ratio or Exact Pixel Size | EditToolbelt',
    description:
      'Crop a photo freely, to 1:1, 4:5, 16:9, 9:16 or a custom ratio, or to exact pixels like 1080×1350. Crop a batch to one ratio. Free, in your browser.',
    h1: 'Crop Image',
    primaryQuery: 'crop image',
    secondaryQueries: ['crop photo online', 'crop image to 16:9', 'crop picture to square'],
  },
  related: ['resize-image', 'rotate-image', 'social-media-image-resizer'],
  willDo: [
    'Crop freely or to 1:1, 4:5, 16:9, 9:16, 4:3, 3:2, 2:3, 21:9 or a custom ratio',
    'Type an exact width and height in px, and see the output size live',
    'Crop a batch to the same ratio, centered, then adjust each image',
  ],
});
