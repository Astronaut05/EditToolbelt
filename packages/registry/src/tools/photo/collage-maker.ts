import { defineTool } from '../../define';

export default defineTool({
  id: 'collage-maker',
  code: 'P16',
  slug: 'collage-maker',
  category: 'photo',
  name: 'Collage Maker',
  tagline: 'Arrange 2-9 photos in a layout template and export them as one image.',
  summary: '2-9 photos in a layout template',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'form',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Photo Collage Maker, Up to 9 Photos | EditToolbelt',
    description:
      'Put 2-9 photos into a collage template. Set spacing, corner radius and background, then export at a preset output size. Free, in your browser.',
    h1: 'Photo Collage Maker',
    primaryQuery: 'photo collage maker',
    secondaryQueries: [],
  },
  related: ['split-image', 'social-media-image-resizer', 'images-to-pdf'],
  willDo: [
    'Place 2-9 images into a layout template',
    'Set spacing, corner radius and background',
    'Export at an output size preset',
  ],
});
