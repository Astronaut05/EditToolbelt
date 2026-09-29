import { defineTool } from '../../define';

export default defineTool({
  id: 'blur-image',
  code: 'P12',
  slug: 'blur-image',
  category: 'photo',
  name: 'Blur & Pixelate Image',
  tagline: 'Blur, pixelate or cover faces and license plates before you share a photo.',
  summary: 'Brush, box or automatic face detection',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['image-paint', 'image-ml'],
  ui: 'canvas-editor',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Blur Face in Photo, Auto Detect or Brush | EditToolbelt',
    description:
      'Blur, pixelate or box out faces and license plates with a brush or rectangle, or detect faces and pick which to hide. Runs in your browser, free.',
    h1: 'Blur Face in Photo',
    primaryQuery: 'blur face in photo',
    secondaryQueries: ['pixelate image', 'censor image online'],
  },
  related: ['exif-remover', 'draw-on-image', 'photo-editor'],
  willDo: [
    'Blur, pixelate or cover areas with a solid box, using a brush or rectangle',
    'Detect faces automatically, then toggle each one on or off',
    'Set the strength, and draw a box by hand over license plates',
  ],
});
