import { defineTool } from '../../define';

export default defineTool({
  id: 'photo-editor',
  code: 'P01',
  slug: 'photo-editor',
  category: 'photo',
  name: 'Photo Editor',
  tagline: 'Crop, adjust, draw and add text in one editor, then export at full resolution.',
  summary: 'Crop, draw, text and adjust in one place',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['image-geometry', 'image-paint'],
  ui: 'canvas-editor',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Online Photo Editor, Free with No Sign Up | EditToolbelt',
    description:
      'Crop, resize, rotate, draw, add text, blur and adjust brightness, contrast or warmth in one editor. Runs in your browser and exports at full resolution.',
    h1: 'Online Photo Editor',
    primaryQuery: 'online photo editor free no sign up',
    secondaryQueries: ['quick photo editor'],
  },
  related: ['crop-image', 'add-text-to-image', 'compress-image'],
  willDo: [
    'Crop, resize, rotate, flip, draw, add text and blur or pixelate in one editor',
    'Adjust brightness, contrast, saturation, exposure and warmth with a live preview',
    'Undo any step until export, then save at full resolution with a size preview',
  ],
});
