import { defineTool } from '../../define';

export default defineTool({
  id: 'contrast-checker',
  code: 'C04',
  slug: 'contrast-checker',
  category: 'color',
  name: 'Contrast Checker',
  tagline:
    'Get the WCAG 2.2 contrast ratio of a text and background pair, with AA and AAA results.',
  summary: 'WCAG 2.2 AA and AAA pass or fail',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['text'],
  ui: 'calculator',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Color Contrast Checker, WCAG 2.2 AA and AAA | EditToolbelt',
    description:
      'Enter a text and background color to get the WCAG 2.2 contrast ratio, AA and AAA results for normal and large text, and the nearest color that passes.',
    h1: 'Color Contrast Checker',
    primaryQuery: 'color contrast checker',
    secondaryQueries: ['wcag contrast checker'],
    howTo: [
      'Type or paste the text color and the background color, in any notation: HEX, RGB, HSL or a CSS name.',
      'Or pick each one with the color picker.',
      'Read the contrast ratio and the pass or fail for AA and AAA, normal and large text.',
      'If it falls short, use the nearest passing text or background color the tool suggests.',
    ],
    faq: [
      {
        q: 'What contrast ratio does WCAG 2.2 require?',
        a: 'Level AA needs 4.5:1 for normal text and 3:1 for large text, icons and borders. Level AAA needs 7:1 for normal text and 4.5:1 for large text.',
      },
      {
        q: 'What counts as large text?',
        a: 'Text of at least 24 px, or at least 18.66 px when bold. In print terms that is 18 pt, or 14 pt bold.',
      },
      {
        q: 'Why does it say 4.49:1 and not 4.5:1?',
        a: 'The ratio is cut to two decimals, never rounded up, so a pair that misses 4.5:1 by a hair never looks like a pass. #777777 on white is 4.47:1 and fails AA; #767676 is 4.54:1 and passes.',
      },
      {
        q: 'How is the suggested color chosen?',
        a: 'It keeps the hue and moves only the lightness, darker or lighter, just far enough to reach your target. Between the two directions it picks the one that changes the color least.',
      },
      {
        q: 'Does it handle transparent colors?',
        a: 'Yes. A transparent text color is measured over the background, and a transparent background over white, which is what a page shows behind it by default.',
      },
    ],
  },
  related: ['color-converter', 'color-picker-from-image', 'color-palette-from-image'],
  willDo: [
    'Calculate the WCAG 2.2 contrast ratio of any text and background pair, from 1:1 to 21:1',
    'Show AA and AAA pass or fail for normal text and for large text',
    'Suggest the nearest passing color when your pair falls short',
  ],
});
