import { defineTool } from '../../define';

export default defineTool({
  id: 'rotate-image',
  code: 'P04',
  slug: 'rotate-image',
  category: 'photo',
  name: 'Rotate & Flip Image',
  tagline: 'Rotate by 90° or any angle, straighten a tilted photo, or mirror it.',
  summary: '90°, free angle, mirror',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'canvas-editor',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Rotate Image, Flip, Mirror or Straighten | EditToolbelt',
    description:
      'Rotate photos 90°, 180° or 270°, straighten them from -45° to 45° in 0.1° steps, or flip them horizontally or vertically. Free, in your browser.',
    h1: 'Rotate Image',
    primaryQuery: 'rotate image',
    secondaryQueries: ['flip image', 'mirror image online', 'straighten photo'],
  },
  related: ['crop-image', 'photo-editor', 'resize-image'],
  willDo: [
    'Rotate 90°, 180° or 270°, and flip horizontally or vertically',
    'Straighten from -45° to 45° in 0.1° steps, with auto-crop or an expanded canvas',
    'Rotate a batch of images by 90° in one go',
  ],
});
