import { defineTool } from '../../define';

export default defineTool({
  id: 'object-eraser',
  code: 'P17',
  slug: 'object-eraser',
  category: 'photo',
  name: 'Object Eraser',
  tagline: 'Brush over an unwanted object and AI fills the area to match the rest of the photo.',
  summary: 'Brush it out, AI fills the gap',
  // An admin switches it on (status beta) in the server build, once Modal runs it.
  status: 'soon',
  wave: 3,
  runtime: 'server-gpu',
  engines: ['image-ml-server'],
  ui: 'canvas-editor',
  batch: false,
  accepts: ['image/png', 'image/jpeg', 'image/webp'],
  outputs: ['png', 'jpg', 'webp'],
  limits: {
    // The fill works on a crop around each area, so size costs little: 50 MP, as P07's server path.
    server: {
      free: { maxBytes: 25 * 1024 ** 2, maxPixels: 50_000_000 },
      paid: { maxBytes: 100 * 1024 ** 2, maxPixels: 50_000_000 },
    },
    // The GPU function stops at 5 min; this leaves room for a cold start.
    timeoutSec: 10 * 60,
    maxConcurrent: 2,
  },
  cost: { kind: 'flat', credits: 3 },
  gpu: 'T4',
  surfaces: ['web', 'mobile', 'api'],
  seo: {
    title: 'Remove Object from Photo, Brush and AI Fill | EditToolbelt',
    description:
      'Paint over an object and an AI inpainting model fills the area to match. Only what you brush changes, and the photo keeps its full size. PNG, JPG or WebP.',
    h1: 'Remove Object from Photo',
    primaryQuery: 'remove object from photo',
    secondaryQueries: [
      'remove unwanted objects from photos',
      'ai object remover',
      'erase object from image',
    ],
    howTo: [
      'Drop a PNG, JPG or WebP photo.',
      'Brush over what to remove, a little past its edges and over its shadow. Unmark or undo any stroke.',
      'Pick the format: PNG keeps every other pixel exactly as it was.',
      'Select Erase on our servers and download the photo at its full size.',
    ],
    faq: [
      {
        q: 'Which AI model fills the area?',
        a: 'MI-GAN, an inpainting model from Picsart AI Research, released for commercial use. It fills each area you brush from the photo around it.',
      },
      {
        q: 'Does the rest of my photo change?',
        a: 'No. Only what you brush, and a few pixels past its edges, is replaced. The size stays the same. PNG keeps every other pixel exactly; JPG and WebP are saved again at high quality.',
      },
      {
        q: 'What works best?',
        a: 'Small and medium objects on plain or repeating backgrounds: people in the distance, wires, signs, spots, text. Large areas next to fine detail come out softer.',
      },
      {
        q: 'What does it cost?',
        a: '3 credits a photo, up to 50 MP. Your photo, the mask and the result are deleted within an hour.',
      },
    ],
  },
  related: ['remove-background', 'blur-image', 'upscale-image'],
  willDo: [
    'Brush over an object, set the brush size, and erase it',
    'Fill the area with AI while the rest of the photo and its size stay the same',
    'Keep every untouched pixel exactly as it was when saved as PNG',
  ],
});
