import { defineTool } from '../../define';

export default defineTool({
  id: 'image-converter',
  code: 'P06',
  slug: 'image-converter',
  category: 'photo',
  name: 'Image Converter',
  tagline: 'Convert images to JPG, PNG, WebP, AVIF or BMP, one file or a batch of 50.',
  summary: 'HEIC, WebP, AVIF, PNG, JPG',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['image-codec'],
  ui: 'form',
  batch: true,
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
  outputs: ['jpg', 'png', 'webp', 'avif', 'bmp'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Image Converter, JPG, PNG, WebP and AVIF | EditToolbelt',
    description:
      'Convert images to JPG, PNG, WebP, AVIF or BMP, one file or 50 at once, in your browser. Transparency, quality and GPS location handled for you.',
    h1: 'Image Converter',
    primaryQuery: 'image converter',
    secondaryQueries: ['heic to jpg', 'webp to jpg', 'png to jpg'],
    howTo: [
      'Drop one or more images: JPG, PNG, WebP, AVIF, GIF, BMP, or HEIC in Safari.',
      'Pick the format to convert to, and the quality for JPG, WebP and AVIF.',
      'Choose what happens to metadata: camera details without the GPS location, or nothing at all.',
      'Select Convert, then download each image or all of them in one ZIP.',
    ],
    faq: [
      {
        q: 'Can it convert iPhone HEIC photos?',
        a: 'Yes, in Safari on a Mac, iPhone or iPad, which can open HEIC. Chrome and Firefox can’t decode HEIC yet, and the tool tells you when that happens. On an iPhone, Settings > Camera > Formats > Most Compatible saves new photos as JPG.',
      },
      {
        q: 'Does converting lose quality?',
        a: 'PNG and BMP are lossless. JPG, WebP and AVIF are lossy: at the default quality of 85 the difference is hard to see, and you can raise it to 100.',
      },
      {
        q: 'What happens to transparency?',
        a: 'PNG, WebP and AVIF keep it. JPG can’t store it, so transparent areas are filled with white or black, your choice. BMP keeps it as a 32-bit file.',
      },
      {
        q: 'Is my photo’s location removed?',
        a: 'Yes, by default. The GPS location is removed and camera details such as the model and exposure are kept, in JPG, PNG and WebP output. Pick Remove all to drop every tag. AVIF and BMP output carry no metadata.',
      },
      {
        q: 'Can I convert many images at once?',
        a: 'Yes, up to 50 at a time. Each one is converted on your device, and you can download them one by one or in one ZIP.',
      },
    ],
  },
  related: ['compress-image', 'resize-image', 'images-to-pdf'],
  willDo: [
    'Convert to JPG, PNG, WebP, AVIF, GIF, BMP or TIFF, one file or a batch',
    'Open iPhone HEIC photos as JPG or PNG, with the right orientation',
    'Pick a background color for transparent images saved as JPG, and keep or strip metadata',
  ],
});
