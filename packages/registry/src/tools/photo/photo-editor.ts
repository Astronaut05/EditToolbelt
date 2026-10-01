import { defineTool } from '../../define';

export default defineTool({
  id: 'photo-editor',
  code: 'P01',
  slug: 'photo-editor',
  category: 'photo',
  name: 'Photo Editor',
  tagline: 'Crop, adjust, draw and add text in one editor, then export at full resolution.',
  summary: 'Crop, draw, text and adjust in one place',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['image-geometry', 'image-paint'],
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
  surfaces: ['web'],
  seo: {
    title: 'Online Photo Editor, Free with No Sign Up | EditToolbelt',
    description:
      'Crop, straighten, rotate, draw, add text, blur and adjust brightness, contrast or warmth in one editor. Runs in your browser and saves at full resolution.',
    h1: 'Online Photo Editor',
    primaryQuery: 'online photo editor free no sign up',
    secondaryQueries: ['quick photo editor'],
    howTo: [
      'Drop a photo.',
      'Pick a mode on the left: Crop, Straighten, Rotate, Flip, Adjust, Draw, Text or Blur. Every change can be undone.',
      'Set the size, format and quality in the settings.',
      'Save the image: every edit is applied at full resolution, in the order shown in the preview.',
    ],
    faq: [
      {
        q: 'Do I need an account?',
        a: 'No. Open the page, drop a photo and edit. Nothing to sign up for and no watermark.',
      },
      {
        q: 'Does the saved photo look like the preview?',
        a: 'Yes. Adjustments, blurred areas, drawings and text are drawn by the same code on screen and at full size, then the crop, turns and straightening are applied the way the editor shows them.',
      },
      {
        q: 'Is my photo uploaded?',
        a: 'No. Editing and saving happen in this browser, and the photo never leaves your device.',
      },
    ],
  },
  related: ['crop-image', 'add-text-to-image', 'compress-image'],
  willDo: [
    'Crop, straighten, rotate, flip, draw, add text and blur or pixelate in one editor',
    'Adjust exposure, brightness, contrast, saturation and warmth with a live preview',
    'Undo any step until you save, then export at full resolution',
  ],
});
