import { defineTool } from '../../define';

export default defineTool({
  id: 'split-image',
  code: 'P14',
  slug: 'split-image',
  category: 'photo',
  name: 'Split Image into Grid',
  tagline: 'Cut one image into equal tiles for carousels, panoramas and 3×3 profile grids.',
  summary: 'Rows × columns, carousels and 3×3 grids',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Split Image into Grid, Carousel and 3×3 Tiles | EditToolbelt',
    description:
      'Split a photo into rows and columns for Instagram carousels, panorama posts and 3×3 profile grids. Use a preset or your own grid, free in your browser.',
    h1: 'Split Image into Grid',
    primaryQuery: 'split image into grid',
    secondaryQueries: ['instagram grid maker', 'panorama carousel splitter'],
  },
  related: ['social-media-image-resizer', 'crop-image', 'collage-maker'],
  willDo: [
    'Split into any rows × cols grid, or use the 1×2, 1×3, 1×10 carousel and 3×3 presets',
    'Choose how gaps are handled and the order the tiles are named in',
    'Make a panorama carousel or a 3×3 profile grid from one image',
  ],
});
