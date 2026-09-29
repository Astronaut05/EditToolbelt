import { defineTool } from '../../define';

export default defineTool({
  id: 'lut-converter',
  code: 'C06',
  slug: 'lut-converter',
  category: 'color',
  name: 'LUT Converter',
  tagline: 'Convert LUTs between .cube and .3dl and resize the grid to 17, 33 or 65 points.',
  summary: 'Convert .cube and .3dl, resize the grid',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['text'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Cube to 3DL Converter, Resize LUT Grids | EditToolbelt',
    description:
      'Convert LUT files between .cube and .3dl, resample the grid to 17, 33 or 65 points, and switch between 1D and 3D where the conversion is valid.',
    h1: 'Cube to 3DL LUT Converter',
    primaryQuery: 'cube to 3dl',
    secondaryQueries: [],
  },
  related: ['lut-preview', 'extract-frames', 'color-converter'],
  willDo: [
    'Convert LUTs from .cube to .3dl and from .3dl to .cube',
    'Resize the LUT grid to 17, 33 or 65 points',
    'Switch between 1D and 3D LUTs where the conversion is valid',
  ],
});
