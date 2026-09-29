import { defineTool } from '../../define';

export default defineTool({
  id: 'video-background-remover',
  code: 'V21',
  slug: 'video-background-remover',
  category: 'video',
  name: 'Video Background Remover',
  tagline: 'Cut people and objects out of video, onto transparency or a green screen.',
  summary: 'Transparent or green screen output',
  status: 'soon',
  wave: 3,
  runtime: 'server-gpu',
  engines: ['video-ml-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMinute', credits: 8, minCredits: 8 },
  surfaces: ['web', 'api'],
  seo: {
    title: 'Remove Video Background, Export with Alpha | EditToolbelt',
    description:
      'Separate people and objects from the background with AI. Export with transparency as ProRes 4444 or WebM with alpha, or on a green screen or solid color.',
    h1: 'Remove Video Background',
    primaryQuery: 'remove video background',
    secondaryQueries: [],
  },
  related: ['remove-background', 'trim-video', 'video-converter'],
  willDo: [
    'Cut out people and objects from each frame with an AI matting model',
    'Export with transparency as ProRes 4444 or WebM with alpha',
    'Place the subject on a green screen or a solid color instead',
  ],
});
