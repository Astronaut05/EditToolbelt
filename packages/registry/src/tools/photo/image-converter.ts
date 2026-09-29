import { defineTool } from '../../define';

export default defineTool({
  id: 'image-converter',
  code: 'P06',
  slug: 'image-converter',
  category: 'photo',
  name: 'Image Converter',
  tagline: 'Convert iPhone HEIC photos and other images to JPG, PNG, WebP or AVIF.',
  summary: 'HEIC, WebP, AVIF, PNG, JPG',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['image-codec'],
  ui: 'form',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Image Converter, HEIC to JPG and More | EditToolbelt',
    description:
      'Convert images between JPG, PNG, WebP, AVIF, GIF, BMP and TIFF, including iPhone HEIC to JPG or PNG. Convert up to 50 files at once, in your browser.',
    h1: 'Image Converter',
    primaryQuery: 'image converter',
    secondaryQueries: ['heic to jpg', 'webp to jpg', 'png to jpg'],
  },
  related: ['compress-image', 'resize-image', 'images-to-pdf'],
  willDo: [
    'Convert to JPG, PNG, WebP, AVIF, GIF, BMP or TIFF, one file or a batch',
    'Open iPhone HEIC photos as JPG or PNG, with the right orientation',
    'Pick a background color for transparent images saved as JPG, and keep or strip metadata',
  ],
});
