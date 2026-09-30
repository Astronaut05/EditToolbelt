import { defineTool } from '../../define';

export default defineTool({
  id: 'crop-image',
  code: 'P02',
  slug: 'crop-image',
  category: 'photo',
  name: 'Crop Image',
  tagline: 'Crop to a ratio or an exact pixel size, and see the size in px as you drag.',
  summary: 'Free, ratio presets or exact px',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'canvas-editor',
  batch: true,
  accepts: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'],
  outputs: ['jpg', 'png', 'webp', 'avif', 'bmp'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Crop Image, Any Ratio or Exact Pixel Size | EditToolbelt',
    description:
      'Crop a photo freely, to 1:1, 4:5, 16:9, 9:16 or a custom ratio, or to exact pixels like 1080×1350. Crop a batch to one ratio. Free, in your browser.',
    h1: 'Crop Image',
    primaryQuery: 'crop image',
    secondaryQueries: ['crop photo online', 'crop image to 16:9', 'crop picture to square'],
    howTo: [
      'Drop an image, or several to crop them all to one ratio.',
      'Pick a ratio such as 1:1, 4:5 or 16:9, or keep Free.',
      'Drag the box or its corners, or type the width, height and position in px.',
      'Select Crop, then download the image. Back to the editor lets you adjust it.',
    ],
    faq: [
      {
        q: 'Does cropping lower the quality?',
        a: 'The pixels inside the box are kept exactly as they are, nothing is resampled. PNG stays lossless. JPG, WebP and AVIF are saved again at quality 90 by default, which you can raise to 100.',
      },
      {
        q: 'How do I crop to exactly 1080 × 1350 px?',
        a: 'Type 1080 and 1350 in the crop box fields, then drag the box to the part you want. If your photo is bigger and you want all of it in the frame, crop to 4:5 first, then use Resize Image to make it 1080 × 1350.',
      },
      {
        q: 'Can I crop many images at once?',
        a: 'Yes, up to 50. Pick a ratio and each image is cropped to it, centered, then download them one by one or in one ZIP.',
      },
      {
        q: 'Is transparency kept?',
        a: 'Yes, when the result is PNG, WebP or AVIF. JPG has no transparency, so transparent areas become white.',
      },
      {
        q: 'Is my photo uploaded?',
        a: 'No. Cropping runs in your browser, and the GPS location is removed from the result by default while camera details are kept.',
      },
    ],
  },
  related: ['resize-image', 'rotate-image', 'social-media-image-resizer'],
  willDo: [
    'Crop freely or to 1:1, 4:5, 16:9, 9:16, 4:3, 3:2, 2:3, 21:9 or a custom ratio',
    'Type an exact width and height in px, and see the output size live',
    'Crop a batch to the same ratio, centered, then adjust each image',
  ],
});
