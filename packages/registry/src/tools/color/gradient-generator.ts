import { defineTool } from '../../define';

export default defineTool({
  id: 'gradient-generator',
  code: 'C07',
  slug: 'gradient-generator',
  category: 'color',
  name: 'Gradient Generator',
  tagline: 'Build linear, radial or conic gradients, then copy the CSS or save a PNG at your size.',
  summary: 'Linear, radial and conic, as CSS or PNG',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['image-color'],
  ui: 'calculator',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Gradient Generator, Export CSS or PNG | EditToolbelt',
    description:
      'Make linear, radial and conic gradients from your own color stops. Smooth mode blends in Oklch to avoid muddy middles. Copy the CSS or save a PNG.',
    h1: 'Gradient Generator',
    primaryQuery: 'gradient generator',
    secondaryQueries: [],
  },
  related: ['color-palette-from-image', 'color-converter', 'color-picker-from-image'],
  willDo: [
    'Build linear, radial or conic gradients from your own color stops',
    'Turn on the smooth option to blend in Oklch, so the middle does not go muddy',
    'Copy the CSS, or export a PNG at the width and height you choose',
  ],
});
