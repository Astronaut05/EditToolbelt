import { defineTool } from '../../define';

export default defineTool({
  id: 'color-palette-from-image',
  code: 'C01',
  slug: 'color-palette-from-image',
  category: 'color',
  name: 'Color Palette from Image',
  tagline: 'Extract the 3-12 dominant colors of an image and export them as CSS, JSON or ASE.',
  summary: 'Dominant 3-12 colors, with % coverage',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['image-color'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Color Palette from Image, CSS and ASE Export | EditToolbelt',
    description:
      'Drop an image to get its 3-12 dominant colors with % coverage. Copy HEX, RGB or HSL, or export CSS variables, JSON, ASE or a PNG swatch strip.',
    h1: 'Color Palette from Image',
    primaryQuery: 'color palette from image',
    secondaryQueries: ['extract colors from image', 'image color palette generator'],
  },
  related: ['color-picker-from-image', 'color-converter', 'gradient-generator'],
  willDo: [
    'Extract 3-12 dominant, vibrant or muted colors, with the % of the image each one covers',
    'Skip near-white and near-black pixels so a plain background does not crowd the palette',
    'Export CSS variables, JSON, an ASE swatch file for Adobe apps, or a PNG swatch strip',
  ],
});
