import { defineTool } from '../../define';

export default defineTool({
  id: 'resize-image',
  code: 'P03',
  slug: 'resize-image',
  category: 'photo',
  name: 'Resize Image',
  tagline: 'Resize to exact pixels, a percentage or the longest side, one image or a batch.',
  summary: 'Exact pixels, percent or presets',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'form',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Resize Image, Exact Pixels or Percentage | EditToolbelt',
    description:
      'Resize photos to an exact width and height, a percentage or the longest side, with presets like Full HD 1920×1080. Resize up to 50 images at once.',
    h1: 'Resize Image',
    primaryQuery: 'resize image',
    secondaryQueries: ['resize image to 1920x1080', 'resize photo in pixels', 'batch resize images'],
  },
  related: ['crop-image', 'compress-image', 'upscale-image'],
  willDo: [
    'Resize to exact W×H, width only, height only, a percentage or the longest side',
    'Fit a box with a padding color, fill and crop, or stretch when the ratio is unlocked',
    'Start from presets like Full HD 1920×1080, 4K 3840×2160 or Story 1080×1920',
  ],
});
