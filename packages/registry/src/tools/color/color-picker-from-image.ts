import { defineTool } from '../../define';

export default defineTool({
  id: 'color-picker-from-image',
  code: 'C02',
  slug: 'color-picker-from-image',
  category: 'color',
  name: 'Color Picker from Image',
  tagline: 'Click any point of an image to read its exact color in HEX, RGB and HSL.',
  summary: 'Exact HEX from any pixel, with a loupe',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['image-color'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Color Picker from Image, Pixel-Exact HEX | EditToolbelt',
    description:
      'Click or tap any point of an image to read its exact color in HEX, RGB and HSL. Sample 1 px or a 3×3 or 5×5 average, zoom in, and keep a history.',
    h1: 'Color Picker from Image',
    primaryQuery: 'color picker from image',
    secondaryQueries: ['get hex code from image', 'eyedropper online'],
  },
  related: ['color-palette-from-image', 'color-converter', 'contrast-checker'],
  willDo: [
    'Click or tap anywhere on an image to read its exact color, with a loupe for precise picks',
    'Sample a single pixel or average a 3×3 or 5×5 area to smooth out noise',
    'Keep a history of picked colors, each with a copy button for HEX, RGB and HSL',
  ],
});
