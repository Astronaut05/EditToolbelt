import { defineTool } from '../../define';

export default defineTool({
  id: 'color-converter',
  code: 'C03',
  slug: 'color-converter',
  category: 'color',
  name: 'Color Converter',
  tagline: 'Type one color code and get HEX, RGB, HSL, HSV, CMYK, Lab and Oklch at once.',
  summary: 'HEX, RGB, HSL, CMYK, Lab and Oklch',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['text'],
  ui: 'calculator',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile', 'panel'],
  seo: {
    title: 'HEX to RGB Converter, Plus HSL, CMYK and Lab | EditToolbelt',
    description:
      'Convert a color between HEX, RGB, HSL, HSV, Lab, Oklch and approximate CMYK. Find the nearest CSS color name and get tints and shades to copy.',
    h1: 'HEX to RGB Color Converter',
    primaryQuery: 'hex to rgb',
    secondaryQueries: ['rgb to hex', 'color code converter'],
  },
  related: ['color-picker-from-image', 'contrast-checker', 'color-palette-from-image'],
  willDo: [
    'Convert between HEX, RGB, HSL, HSV/HSB, CMYK, Lab and Oklch as you type',
    'Name the nearest CSS color and show tints and shades of the one you entered',
    'Give an approximate CMYK value, clearly labeled as not color-managed',
  ],
});
