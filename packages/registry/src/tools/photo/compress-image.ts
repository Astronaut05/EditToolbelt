import { defineTool } from '../../define';

export default defineTool({
  id: 'compress-image',
  code: 'P05',
  slug: 'compress-image',
  category: 'photo',
  name: 'Compress Image',
  tagline: 'Shrink image files by quality, or to a target size in KB or MB.',
  summary: 'By quality or to a target size',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['image-codec'],
  ui: 'form',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Compress Image to a Target Size in KB or MB | EditToolbelt',
    description:
      'Reduce JPG, PNG, WebP and AVIF file size with a quality slider or a target like 100 KB. See the size before and after, and batch up to 50 images.',
    h1: 'Compress Image',
    primaryQuery: 'compress image',
    secondaryQueries: ['compress jpeg to 100kb', 'reduce image size', 'compress png'],
  },
  related: ['resize-image', 'image-converter', 'exif-remover'],
  willDo: [
    'Compress with a quality slider, or to a target size in KB or MB',
    'Save as JPG, WebP or AVIF, or optimize PNG losslessly',
    'See before and after sizes, the % saved and a before/after slider',
  ],
});
