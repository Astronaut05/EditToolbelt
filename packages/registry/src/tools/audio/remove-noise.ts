import { defineTool } from '../../define';

export default defineTool({
  id: 'remove-noise',
  code: 'A10',
  slug: 'remove-noise',
  category: 'audio',
  name: 'Noise Reduction',
  tagline: 'Reduce background noise, hum and hiss in voice recordings with AI.',
  summary: 'Less noise, hum and hiss in speech',
  status: 'soon',
  wave: 2,
  runtime: 'server-cpu',
  engines: ['audio-ml-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMinute', credits: 1, minCredits: 1 },
  surfaces: ['web', 'mobile', 'panel', 'api'],
  seo: {
    title: 'Remove Background Noise from Audio, with AI | EditToolbelt',
    description:
      'Clean up speech: reduce background noise, hiss and 50 or 60 Hz hum with an AI model. Compare before and after on a free 10-second preview first.',
    h1: 'Remove Background Noise from Audio',
    primaryQuery: 'remove background noise from audio',
    secondaryQueries: ['noise reduction online', 'clean up voice recording'],
  },
  related: ['normalize-audio', 'remove-silence', 'transcribe-audio'],
  willDo: [
    'Reduce background noise, hum and hiss in speech at Light, Medium or Strong strength',
    'Remove 50 or 60 Hz mains hum, and clean the sound of a video without uploading the video',
    'Compare before and after on a free 10-second A/B preview',
  ],
});
