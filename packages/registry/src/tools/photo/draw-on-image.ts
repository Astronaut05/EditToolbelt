import { defineTool } from '../../define';

export default defineTool({
  id: 'draw-on-image',
  code: 'P09',
  slug: 'draw-on-image',
  category: 'photo',
  name: 'Draw on Image',
  tagline: 'Mark up screenshots and photos with arrows, boxes, highlights and numbered markers.',
  summary: 'Arrows, boxes, highlighter and markers',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['image-paint'],
  ui: 'canvas-editor',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Draw on Image, Add Arrows, Boxes and Markers | EditToolbelt',
    description:
      'Annotate screenshots and photos with a brush, highlighter, lines, arrows, rectangles, ellipses and numbered markers. Set color, size and opacity for each.',
    h1: 'Draw on Image',
    primaryQuery: 'draw on image',
    secondaryQueries: ['annotate screenshot', 'add arrow to image'],
  },
  related: ['add-text-to-image', 'blur-image', 'photo-editor'],
  willDo: [
    'Annotate with a brush, highlighter, line, arrow, rectangle, ellipse or numbered markers',
    'Set color, size and opacity for each tool',
    'Undo and redo any stroke, then export the annotated image',
  ],
});
