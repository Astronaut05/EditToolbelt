import { defineTool } from '../../define';

export default defineTool({
  id: 'dpi-calculator',
  code: 'U03',
  slug: 'dpi-calculator',
  category: 'utility',
  name: 'Print Size & DPI Calculator',
  tagline:
    'Find the print size of an image at any DPI, or the pixels a print needs, in cm or inches.',
  summary: 'Pixels to cm or inches at any DPI',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['text'],
  ui: 'calculator',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'DPI Calculator, Pixels to Print Size | EditToolbelt',
    description:
      'Convert pixels to print size in cm, mm or inches at any DPI, get the pixels a print needs at 150 or 300 DPI, and check A-series, Letter and photo sizes.',
    h1: 'DPI Calculator',
    primaryQuery: 'dpi calculator',
    secondaryQueries: ['pixels to cm', 'image print size calculator'],
  },
  related: ['resize-image', 'upscale-image', 'aspect-ratio-calculator'],
  willDo: [
    'Convert pixels to print size in cm, mm or inches at any DPI, and back',
    'Get the pixels a print needs at 150 or 300 DPI, with A-series, US Letter and photo presets',
    'Drop an image to see the largest size it prints at acceptable quality',
  ],
});
