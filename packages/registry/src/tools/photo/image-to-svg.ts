import { defineTool } from '../../define';

export default defineTool({
  id: 'image-to-svg',
  code: 'P19',
  slug: 'image-to-svg',
  category: 'photo',
  name: 'Image to SVG',
  tagline: 'Vectorize a logo or illustration into an SVG that scales to any size.',
  summary: 'Vectorize logos and illustrations',
  status: 'beta',
  wave: 3,
  runtime: 'client',
  engines: ['image-vector'],
  ui: 'form',
  batch: false,
  accepts: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/bmp',
    'image/heic',
    'image/heif',
  ],
  outputs: ['svg'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'PNG to SVG, Vectorize Logos and Illustrations | EditToolbelt',
    description:
      'Convert PNG or JPG logos and illustrations to SVG in black and white or color. Tune the color count, detail and smoothness. Free, in your browser.',
    h1: 'PNG to SVG',
    primaryQuery: 'png to svg',
    secondaryQueries: ['vectorize image'],
    howTo: [
      'Drop a logo, icon or illustration: PNG, JPG, WebP, GIF or AVIF.',
      'Pick Colour or Black and white, and how many colours to keep.',
      'Set the detail (how small a shape is kept) and the edges: smooth curves, sharp corners, or the pixels exactly.',
      'Press Make SVG, compare it with the original, and download it.',
    ],
    faq: [
      {
        q: 'Is my image uploaded?',
        a: 'No. It is traced in this browser, and the image never leaves your device.',
      },
      {
        q: 'What works best?',
        a: 'Logos, icons, flat illustrations and scanned line art: shapes of solid colour. A photo turns into flat areas of colour, like a poster; for that, raise the colours and the detail.',
      },
      {
        q: 'What is inside the SVG?',
        a: 'Only filled shapes, one per colour, stacked so neighbouring shapes never show a gap between them. No scripts, no embedded images and no links, so it is safe to open anywhere and easy to edit in Illustrator, Figma or Inkscape.',
      },
      {
        q: 'Why are the edges of my shapes a little different?',
        a: 'Pixel steps are replaced by straight lines and curves. Smooth curves the most, Sharp keeps more corners, and Pixels keeps every pixel edge exactly, for pixel art.',
      },
    ],
  },
  related: ['remove-background', 'color-palette-from-image', 'image-converter'],
  willDo: [
    'Vectorize logos and illustrations in black and white or color mode',
    'Tune the color count, detail and smoothness',
    'Get an SVG we generate ourselves, with no scripts inside',
  ],
});
