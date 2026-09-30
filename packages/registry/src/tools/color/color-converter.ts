import { defineTool } from '../../define';

export default defineTool({
  id: 'color-converter',
  code: 'C03',
  slug: 'color-converter',
  category: 'color',
  name: 'Color Converter',
  tagline: 'Type one color code and get HEX, RGB, HSL, HSV, CMYK, Lab and Oklch at once.',
  summary: 'HEX, RGB, HSL, CMYK, Lab and Oklch',
  status: 'live',
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
    howTo: [
      'Type or paste a color in any format: HEX, RGB, HSL, HSV, CMYK, Lab, Oklch or a CSS name like tomato.',
      'Or choose one with the color picker.',
      'Copy the notation you need. Each row has its own copy button.',
      'Select a tint or shade to convert that one instead.',
    ],
    faq: [
      {
        q: 'How do I convert HEX to RGB?',
        a: 'Split the six digits into three pairs and read each pair as a base-16 number. #ff6347 is ff, 63 and 47, which is 255, 99 and 71, so rgb(255, 99, 71).',
      },
      {
        q: 'Why is the CMYK value only approximate?',
        a: 'Real CMYK depends on the printer, paper and ink, which an ICC profile describes. This tool uses the plain formula without a profile, so treat the numbers as a starting point and ask your print shop for their profile.',
      },
      {
        q: 'What is Oklch?',
        a: 'A way to describe color by lightness, chroma and hue that tracks how bright colors look to people better than HSL does. CSS supports it as oklch(), so you can paste the value straight into a stylesheet.',
      },
      {
        q: 'Which Lab does it use?',
        a: 'CIE Lab with a D50 white point, the same as CSS lab() and Photoshop, so the numbers match what you see there.',
      },
      {
        q: 'Does it handle transparency?',
        a: 'Yes. Paste #ff634780 or rgba(255, 99, 71, 0.5): HEX, RGB, HSL, Lab and Oklch keep the alpha, and the preview shows it over a checkerboard.',
      },
    ],
  },
  related: ['color-picker-from-image', 'contrast-checker', 'color-palette-from-image'],
  willDo: [
    'Convert between HEX, RGB, HSL, HSV/HSB, CMYK, Lab and Oklch as you type',
    'Name the nearest CSS color and show tints and shades of the one you entered',
    'Give an approximate CMYK value, clearly labeled as not color-managed',
  ],
});
