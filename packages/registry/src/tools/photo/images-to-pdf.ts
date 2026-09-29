import { defineTool } from '../../define';

export default defineTool({
  id: 'images-to-pdf',
  code: 'P18',
  slug: 'images-to-pdf',
  category: 'photo',
  name: 'Images to PDF',
  tagline: 'Combine photos or scans into one PDF, in the order you choose.',
  summary: 'Many images, one PDF',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['image-codec'],
  ui: 'form',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'JPG to PDF, Combine Images into One File | EditToolbelt',
    description:
      'Turn JPG, PNG and other images into one PDF. Set the order, page size (A4, Letter or fit to image), margins and orientation. Free, in your browser.',
    h1: 'JPG to PDF',
    primaryQuery: 'jpg to pdf',
    secondaryQueries: [],
  },
  related: ['image-converter', 'compress-image', 'rotate-image'],
  willDo: [
    'Combine multiple images into one PDF, in the order you set',
    'Pick a page size: A4, Letter or fit to image',
    'Set the margins and page orientation',
  ],
});
