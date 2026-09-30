import { defineTool } from '../../define';

export default defineTool({
  id: 'color-picker-from-image',
  code: 'C02',
  slug: 'color-picker-from-image',
  category: 'color',
  name: 'Color Picker from Image',
  tagline: 'Click any point of an image to read its exact color in HEX, RGB and HSL.',
  summary: 'Exact HEX from any pixel, with a loupe',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['image-color'],
  ui: 'form',
  batch: false,
  accepts: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp'],
  outputs: ['css', 'json', 'ase'],
  limits: { client: { maxBytes: 100 * 1024 ** 2 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Color Picker from Image, Pixel-Exact HEX | EditToolbelt',
    description:
      'Click or tap any point of an image to read its exact color in HEX, RGB and HSL. Sample 1 px or a 3×3 or 5×5 average, zoom in, and keep a history.',
    h1: 'Color Picker from Image',
    primaryQuery: 'color picker from image',
    secondaryQueries: ['get hex code from image', 'eyedropper online'],
    howTo: [
      'Drop an image: a photo, a screenshot or a frame from a video.',
      'Point at the image: the loupe and the readout follow. Click or tap to pick the color.',
      'Copy it as HEX, RGB or HSL. Every pick goes into the list, and the list downloads as CSS, JSON or ASE.',
    ],
    faq: [
      {
        q: 'Is the color exact?',
        a: 'Yes. With 1 px, the readout is the pixel’s value as stored in the file, with no color correction on the way.',
      },
      {
        q: 'When should I use 3 × 3 or 5 × 5?',
        a: 'For photos. Single pixels in a photo vary with noise and JPEG blocks; the average of a small block is the color the area reads as. It is averaged in linear light, as the eye mixes light.',
      },
      {
        q: 'Can I pick with the keyboard?',
        a: 'Yes. Tab to the image, move the crosshair with the arrow keys (Shift and an arrow moves 10 px), and press Enter to pick.',
      },
      {
        q: 'Is my image uploaded?',
        a: 'No. The colors are read in your browser.',
      },
    ],
  },
  related: ['color-palette-from-image', 'color-converter', 'contrast-checker'],
  willDo: [
    'Point, click or tap anywhere on an image to read its exact color, with a loupe for precise picks',
    'Sample a single pixel or average a 3×3 or 5×5 area to smooth out noise',
    'Keep a history of picked colors, each with a copy button for HEX, RGB and HSL',
  ],
});
