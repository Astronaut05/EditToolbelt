import { defineTool } from '../../define';

export default defineTool({
  id: 'gradient-generator',
  code: 'C07',
  slug: 'gradient-generator',
  category: 'color',
  name: 'Gradient Generator',
  tagline: 'Build linear, radial or conic gradients, then copy the CSS or save a PNG at your size.',
  summary: 'Linear, radial and conic, as CSS or PNG',
  status: 'beta',
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
    howTo: [
      'Pick linear, radial or conic, and the angle for linear and conic.',
      'Set the colours and where each stop sits, from 0 to 100 %. Add up to 8 stops.',
      'Leave Blend on Smooth to mix in Oklch, so opposite colours meet in a clear middle, or pick Plain for the browser’s own sRGB mix.',
      'Copy the CSS, or save a PNG at the size you need, up to 8,000 px a side.',
    ],
    faq: [
      {
        q: 'Why does the middle of a gradient look grey or muddy?',
        a: 'Browsers mix gradient colours in sRGB by default, which dims the colours halfway between two opposites, like red and blue or yellow and blue. Smooth mixes them in Oklch instead, keeping the middle as bright and saturated as the ends.',
      },
      {
        q: 'Does the Smooth CSS work in every browser?',
        a: 'Yes. Instead of CSS’s newer “in oklch” syntax, the blend is written out as a stop every 10 %, which any browser draws the same way.',
      },
      {
        q: 'Why won’t the PNG show bands?',
        a: 'It is dithered: each 8-bit step is spread over neighbouring pixels in a fine pattern, so wide, gentle gradients stay smooth on screen and in print.',
      },
    ],
  },
  related: ['color-palette-from-image', 'color-converter', 'color-picker-from-image'],
  willDo: [
    'Build linear, radial or conic gradients from your own color stops',
    'Turn on the smooth option to blend in Oklch, so the middle does not go muddy',
    'Copy the CSS, or export a PNG at the width and height you choose',
  ],
});
