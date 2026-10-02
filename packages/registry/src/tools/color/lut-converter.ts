import { defineTool } from '../../define';

export default defineTool({
  id: 'lut-converter',
  code: 'C06',
  slug: 'lut-converter',
  category: 'color',
  name: 'LUT Converter',
  tagline: 'Convert LUTs between .cube and .3dl and resize the grid to 17, 33 or 65 points.',
  summary: 'Convert .cube and .3dl, resize the grid',
  status: 'beta',
  wave: 3,
  runtime: 'client',
  engines: ['text'],
  ui: 'form',
  batch: false,
  accepts: ['.cube', '.3dl'],
  outputs: ['cube', '3dl'],
  limits: { client: { maxBytes: 64 * 1024 * 1024 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Cube to 3DL Converter, Resize LUT Grids | EditToolbelt',
    description:
      'Convert LUT files between .cube and .3dl, resample the grid to 17, 33 or 65 points, and switch between 1D and 3D where the conversion is valid.',
    h1: 'Cube to 3DL LUT Converter',
    primaryQuery: 'cube to 3dl',
    secondaryQueries: [],
    howTo: [
      'Drop a .cube or .3dl LUT.',
      'Pick the format to save it as, and a grid of 17, 33 or 65 points if your app needs one.',
      'To use it where only 1D LUTs work, pick 1D curves. That works when the LUT changes each channel on its own.',
      'Press Convert and download the new LUT.',
    ],
    faq: [
      {
        q: 'Does resizing the grid change the look?',
        a: 'Hardly. The new grid points are read from the original with tetrahedral interpolation, the method grading apps use between points, so the LUT grades the same. Going down to 17 points can soften very sharp changes.',
      },
      {
        q: 'Which .3dl does it write?',
        a: 'Autodesk’s, read by Flame, Lustre and Nuke: a 10-bit input mesh and 12-bit output values, blue changing fastest. Values above 1 or below 0, which a .cube can hold, are clipped, and the page says how many.',
      },
      {
        q: 'Why can’t a 3D LUT become 1D?',
        a: 'A 1D LUT is three separate curves, one per channel. A look that shifts hues or saturation mixes the channels, so only a 3D cube can hold it. Curves-only LUTs, like a gamma or a log-to-linear, convert exactly.',
      },
    ],
  },
  related: ['lut-preview', 'extract-frames', 'color-converter'],
  willDo: [
    'Convert LUTs from .cube to .3dl and from .3dl to .cube',
    'Resize the LUT grid to 17, 33 or 65 points',
    'Switch between 1D and 3D LUTs where the conversion is valid',
  ],
});
