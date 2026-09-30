import { defineTool } from '../../define';

export default defineTool({
  id: 'compress-image',
  code: 'P05',
  slug: 'compress-image',
  category: 'photo',
  name: 'Compress Image',
  tagline: 'Shrink image files by quality, or to a target size in KB or MB.',
  summary: 'By quality or to a target size',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['image-codec'],
  ui: 'form',
  batch: true,
  accepts: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'],
  outputs: ['jpg', 'png', 'webp', 'avif'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Compress Image to a Target Size in KB or MB | EditToolbelt',
    description:
      'Reduce JPG, PNG, WebP and AVIF file size with a quality slider or a target like 100 KB. See the size before and after, and batch up to 50 images.',
    h1: 'Compress Image',
    primaryQuery: 'compress image',
    secondaryQueries: ['compress jpeg to 100kb', 'reduce image size', 'compress png'],
    howTo: [
      'Drop one or more images, up to 50 at once.',
      'Compress by quality with the slider, or enter a target size in KB.',
      'Keep the format, or switch to WebP or AVIF for smaller files. Set a longest side to shrink big photos.',
      'Select Compress, compare before and after, and download.',
    ],
    faq: [
      {
        q: 'How do I compress an image to 100 KB?',
        a: 'Choose Target size, enter 100 KB and pick JPG, WebP or AVIF. The tool tries up to 8 quality levels and keeps the best one under the target. If it is still too big at quality 40, set a longest side such as 1920 px.',
      },
      {
        q: 'Which format gives the smallest file?',
        a: 'Usually AVIF, then WebP, then JPG at the same visual quality. AVIF and WebP open in every current browser; JPG is the safest for email and older apps.',
      },
      {
        q: 'Will it make my PNG bigger?',
        a: 'No. PNG is optimized losslessly, and if the result isn’t smaller you get your original file back.',
      },
      {
        q: 'Is anything uploaded?',
        a: 'No. Compression runs on your device with WebAssembly encoders (MozJPEG, libwebp, libavif and OxiPNG); your images never leave it.',
      },
      {
        q: 'Does it keep camera details?',
        a: 'Yes, by default, without the GPS location, in JPG, PNG and WebP output. Pick Remove all to strip every tag, which also saves a few KB.',
      },
    ],
  },
  related: ['resize-image', 'image-converter', 'exif-remover'],
  willDo: [
    'Compress with a quality slider, or to a target size in KB or MB',
    'Save as JPG, WebP or AVIF, or optimize PNG losslessly',
    'See before and after sizes, the % saved and a before/after slider',
  ],
});
