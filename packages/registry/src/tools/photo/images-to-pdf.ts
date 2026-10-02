import { defineTool } from '../../define';

export default defineTool({
  id: 'images-to-pdf',
  code: 'P18',
  slug: 'images-to-pdf',
  category: 'photo',
  name: 'Images to PDF',
  tagline: 'Combine photos or scans into one PDF, in the order you choose.',
  summary: 'Many images, one PDF',
  status: 'beta',
  wave: 3,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'form',
  batch: true,
  accepts: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/bmp',
    'image/heic',
    'image/heif',
  ],
  outputs: ['pdf'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'JPG to PDF, Combine Images into One File | EditToolbelt',
    description:
      'Turn JPG, PNG and other images into one PDF. Set the order, page size (A4, Letter or fit to image), margins and orientation. Free, in your browser.',
    h1: 'JPG to PDF',
    primaryQuery: 'jpg to pdf',
    secondaryQueries: [],
    howTo: [
      'Drop your images: JPG, PNG, WebP, GIF or AVIF, up to 100.',
      'Drag them into the order you want the pages in.',
      'Pick the page size (A4, Letter, or each page the size of its image), the orientation and the margins.',
      'Press Make PDF and download it.',
    ],
    faq: [
      {
        q: 'Are my images uploaded?',
        a: 'No. The PDF is made in this browser, and the images never leave your device.',
      },
      {
        q: 'Do the photos lose quality?',
        a: 'No. JPEGs go into the PDF byte for byte, exactly as they were. PNG, WebP and the rest are stored losslessly, transparency included.',
      },
      {
        q: 'Will a phone photo come out sideways?',
        a: 'No. A photo the phone saved turned on its side, with a note saying which way is up, is placed upright on its page, still without re-encoding it.',
      },
    ],
  },
  related: ['image-converter', 'compress-image', 'rotate-image'],
  willDo: [
    'Combine multiple images into one PDF, in the order you set',
    'Pick a page size: A4, Letter or fit to image',
    'Set the margins and page orientation',
  ],
});
