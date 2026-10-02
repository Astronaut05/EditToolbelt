import { defineTool } from '../../define';

export default defineTool({
  id: 'blur-image',
  code: 'P12',
  slug: 'blur-image',
  category: 'photo',
  name: 'Blur & Pixelate Image',
  tagline: 'Blur, pixelate or cover faces and license plates before you share a photo.',
  summary: 'Brush, box or automatic face detection',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['image-paint', 'image-ml'],
  ui: 'canvas-editor',
  batch: false,
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
  outputs: ['jpg', 'png', 'webp', 'avif'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Blur Face in Photo, Auto Detect or Brush | EditToolbelt',
    description:
      'Blur, pixelate or box out faces and license plates with a brush or box, or find faces automatically and pick which to hide. Free, in your browser.',
    h1: 'Blur Face in Photo',
    primaryQuery: 'blur face in photo',
    secondaryQueries: ['pixelate image', 'censor image online'],
    howTo: [
      'Drop a photo.',
      'Press Find faces to hide every face at once, then tap any face you want to leave as it is.',
      'Drag a box, an ellipse or a brush stroke over anything else, like a license plate or a name tag.',
      'Pick Blur, Pixelate or Solid and the strength, then save the image at its full size.',
    ],
    faq: [
      {
        q: 'Is my photo uploaded to find the faces?',
        a: 'No. A small face detector (YuNet, 0.2 MB) runs in this browser, the first time after a one-off download of the AI runtime. The photo never leaves your device.',
      },
      {
        q: 'Can a blur or pixelation be undone?',
        a: 'Every pixel inside an area is replaced, but a weak blur or small blocks can still give a face away. For anything sensitive, use a large strength, or Solid, which leaves nothing of what was there.',
      },
      {
        q: 'Did it find every face?',
        a: 'Most faces turned towards the camera, down to about 30 px across. Faces in profile, covered or very small can be missed, so check the photo and draw a box over any it missed.',
      },
    ],
  },
  related: ['exif-remover', 'draw-on-image', 'photo-editor'],
  willDo: [
    'Blur, pixelate or cover areas with a solid box, using a brush, box or ellipse',
    'Find faces automatically, then toggle each one on or off',
    'Set the strength in px, and draw a box by hand over license plates',
  ],
});
