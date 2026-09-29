import { defineTool } from '../../define';

export default defineTool({
  id: 'add-text-to-image',
  code: 'P10',
  slug: 'add-text-to-image',
  category: 'photo',
  name: 'Add Text to Image',
  tagline: 'Put captions and titles on a photo with stroke, shadow and a background box.',
  summary: 'Fonts with Cyrillic and Uzbek support',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['image-paint'],
  ui: 'canvas-editor',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Add Text to Image, Fonts, Stroke and Shadow | EditToolbelt',
    description:
      'Put text on a photo with font, size, color, stroke, shadow, background box, alignment and rotation. Load your own font file: it stays on your device.',
    h1: 'Add Text to Image',
    primaryQuery: 'add text to image',
    secondaryQueries: ['put text on photo', 'caption image online'],
  },
  related: ['draw-on-image', 'watermark-image', 'social-media-image-resizer'],
  willDo: [
    'Style text with font, size, color, stroke, shadow, background box, alignment and rotation',
    'Use bundled fonts with Cyrillic and Uzbek Latin, or load a font file that stays on your device',
    'Stack several text layers and line them up with snapping guides',
  ],
});
