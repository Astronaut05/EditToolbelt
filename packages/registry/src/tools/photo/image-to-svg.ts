import { defineTool } from '../../define';

export default defineTool({
  id: 'image-to-svg',
  code: 'P19',
  slug: 'image-to-svg',
  category: 'photo',
  name: 'Image to SVG',
  tagline: 'Vectorize a logo or illustration into an SVG that scales to any size.',
  summary: 'Vectorize logos and illustrations',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['image-vector'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'PNG to SVG, Vectorize Logos and Illustrations | EditToolbelt',
    description:
      'Convert PNG or JPG logos and illustrations to SVG in black and white or color. Tune the color count, detail and smoothness. Free, in your browser.',
    h1: 'PNG to SVG',
    primaryQuery: 'png to svg',
    secondaryQueries: ['vectorize image'],
  },
  related: ['remove-background', 'color-palette-from-image', 'image-converter'],
  willDo: [
    'Vectorize logos and illustrations in black and white or color mode',
    'Tune the color count, detail and smoothness',
    'Get an SVG we generate ourselves, with no scripts inside',
  ],
});
