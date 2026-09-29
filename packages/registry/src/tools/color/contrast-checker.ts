import { defineTool } from '../../define';

export default defineTool({
  id: 'contrast-checker',
  code: 'C04',
  slug: 'contrast-checker',
  category: 'color',
  name: 'Contrast Checker',
  tagline: 'Get the WCAG 2.2 contrast ratio of a text and background pair, with AA and AAA results.',
  summary: 'WCAG 2.2 AA and AAA pass or fail',
  status: 'soon',
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
  },
  related: ['color-converter', 'color-picker-from-image', 'color-palette-from-image'],
  willDo: [
    'Calculate the WCAG 2.2 contrast ratio of any text and background pair, from 1:1 to 21:1',
    'Show AA and AAA pass or fail for normal text and for large text',
    'Suggest the nearest passing color when your pair falls short',
  ],
});
