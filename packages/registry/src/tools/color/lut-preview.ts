import { defineTool } from '../../define';

export default defineTool({
  id: 'lut-preview',
  code: 'C05',
  slug: 'lut-preview',
  category: 'color',
  name: 'LUT Preview on Image',
  tagline: 'Apply a .cube LUT to a still frame and compare before and after at any intensity.',
  summary: 'Test a .cube LUT on a still frame',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['image-color'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'LUT Preview Online, Try .cube LUTs on Stills | EditToolbelt',
    description:
      'Load a 1D or 3D .cube LUT and preview it on an exported frame, with an intensity slider and before and after. The LUT file never leaves your browser.',
    h1: 'LUT Preview Online',
    primaryQuery: 'lut preview online',
    secondaryQueries: ['apply lut to image', 'test cube lut'],
  },
  related: ['lut-converter', 'extract-frames', 'color-palette-from-image'],
  willDo: [
    'Load a 1D or 3D .cube LUT and apply it to a still, such as a frame exported from your edit',
    'Set the strength with an intensity slider and compare before and after',
    'Download the graded image, with the LUT file kept in your browser the whole time',
  ],
});
