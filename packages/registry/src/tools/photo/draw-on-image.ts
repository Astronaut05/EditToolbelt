import { defineTool } from '../../define';

export default defineTool({
  id: 'draw-on-image',
  code: 'P09',
  slug: 'draw-on-image',
  category: 'photo',
  name: 'Draw on Image',
  tagline: 'Mark up screenshots and photos with arrows, boxes, highlights and numbered markers.',
  summary: 'Arrows, boxes, highlighter and markers',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['image-paint'],
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
    title: 'Draw on Image, Add Arrows, Boxes and Markers | EditToolbelt',
    description:
      'Annotate screenshots and photos with a brush, highlighter, lines, arrows, rectangles, ellipses and numbered markers. Set color, size and opacity for each.',
    h1: 'Draw on Image',
    primaryQuery: 'draw on image',
    secondaryQueries: ['annotate screenshot', 'add arrow to image'],
    howTo: [
      'Drop a screenshot or photo.',
      'Pick a tool: brush, highlighter, line, arrow, rectangle, ellipse or numbered marker, and its colour, size and opacity.',
      'Drag on the image to draw. Shapes also work with two clicks, start then end, and a marker with one.',
      'Undo or redo any stroke, then save the image at its full size.',
    ],
    faq: [
      {
        q: 'Does the saved image look like the preview?',
        a: 'Yes. Marks are kept as shapes in the image’s own pixels and drawn by the same code on screen and at full size, so a 2 px arrow on a 4000 px screenshot is 2 px in the file.',
      },
      {
        q: 'Can I number steps in a screenshot?',
        a: 'Use the numbered marker: each click places the next number in a circle, in the colour you pick, with the number in black or white, whichever reads better.',
      },
      {
        q: 'Is my image uploaded?',
        a: 'No. Drawing and saving happen in this browser; the image never leaves your device.',
      },
    ],
  },
  related: ['add-text-to-image', 'blur-image', 'photo-editor'],
  willDo: [
    'Annotate with a brush, highlighter, line, arrow, rectangle, ellipse or numbered markers',
    'Set color, size and opacity for each tool',
    'Undo and redo any stroke, then export the annotated image',
  ],
});
