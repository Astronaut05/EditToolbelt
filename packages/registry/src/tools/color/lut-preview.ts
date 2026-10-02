import { defineTool } from '../../define';

export default defineTool({
  id: 'lut-preview',
  code: 'C05',
  slug: 'lut-preview',
  category: 'color',
  name: 'LUT Preview on Image',
  tagline: 'Apply a .cube LUT to a still frame and compare before and after at any intensity.',
  summary: 'Test a .cube LUT on a still frame',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['image-color'],
  ui: 'form',
  batch: false,
  accepts: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'image/heic',
    'image/heif',
  ],
  outputs: ['jpg', 'png', 'webp', 'avif'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'LUT Preview Online, Try .cube LUTs on Stills | EditToolbelt',
    description:
      'Load a 1D or 3D .cube LUT and preview it on an exported frame, with an intensity slider and before and after. The LUT file never leaves your browser.',
    h1: 'LUT Preview Online',
    primaryQuery: 'lut preview online',
    secondaryQueries: ['apply lut to image', 'test cube lut'],
    howTo: [
      'Drop a still: a frame exported from your edit, or any photo.',
      'Choose a .cube LUT, 1D or 3D, from your computer.',
      'Set the intensity, from 0 to 100%, and apply it.',
      'Drag across the result to compare before and after, then download the graded image.',
    ],
    faq: [
      {
        q: 'Which LUTs work?',
        a: 'Any .cube file in the Adobe and Resolve format: a 3D cube from 2³ to 256³ points (17, 33 and 65 are usual), or a 1D curve, with DOMAIN_MIN and DOMAIN_MAX if it has them. A file that can’t be read says what’s wrong and on which line.',
      },
      {
        q: 'Will it look the same as in Premiere or Resolve?',
        a: 'It uses tetrahedral interpolation between the cube’s points, as grading apps do, and matches the LUT to within 1/255. The LUT is applied to the image as it is; a LUT made for log footage expects a log frame, so try it on an ungraded export.',
      },
      {
        q: 'Is my LUT uploaded?',
        a: 'No. The LUT and the image are read in this browser and never leave your device.',
      },
    ],
  },
  related: ['lut-converter', 'extract-frames', 'color-palette-from-image'],
  willDo: [
    'Load a 1D or 3D .cube LUT and apply it to a still, such as a frame exported from your edit',
    'Set the strength with an intensity slider and compare before and after',
    'Download the graded image, with the LUT file kept in your browser the whole time',
  ],
});
