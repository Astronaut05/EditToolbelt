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
  status: 'beta',
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
    howTo: [
      'Choose what to work out: the print size of an image, the pixels a print needs, or the DPI of a print.',
      'Type the image size in pixels, or use an image to read its size. It never leaves your browser.',
      'Pick a paper size or type your own, and a DPI: 300 for photo quality, 150 for posters.',
      'Read the result in cm, mm and inches, and the largest paper the image fills.',
    ],
    faq: [
      {
        q: 'How do I convert pixels to cm?',
        a: 'Divide the pixels by the DPI to get inches, then multiply by 2.54. A 3000 px wide image at 300 DPI prints 10 inches, which is 25.4 cm.',
      },
      {
        q: 'How many pixels do I need for an A4 print?',
        a: '2480 × 3508 at 300 DPI, or 1240 × 1754 at 150 DPI. A4 is 210 × 297 mm.',
      },
      {
        q: 'What DPI should I print at?',
        a: 'At 300 DPI a print looks sharp up close, like a photo or a book. 150 DPI is fine for posters and anything seen from a step back. Below that, edges look soft.',
      },
      {
        q: 'Does DPI change how an image looks on screen?',
        a: 'No. Screens show pixels as they are; the DPI number in a file only tells a printer how big to make it. Changing it without resampling leaves every pixel the same.',
      },
    ],
  },
  related: ['resize-image', 'upscale-image', 'aspect-ratio-calculator'],
  willDo: [
    'Convert pixels to print size in cm, mm or inches at any DPI, and back',
    'Get the pixels a print needs at 150 or 300 DPI, with A-series, US Letter and photo presets',
    'Drop an image to see the largest size it prints at acceptable quality',
  ],
});
