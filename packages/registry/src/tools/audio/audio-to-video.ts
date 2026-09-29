import { defineTool } from '../../define';

export default defineTool({
  id: 'audio-to-video',
  code: 'A16',
  slug: 'audio-to-video',
  category: 'audio',
  name: 'Audio to Video',
  tagline: 'Turn audio into a video with a moving waveform over an image, in 9:16, 1:1 or 16:9.',
  summary: 'Audiogram in 9:16, 1:1 or 16:9',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['audio-dsp', 'video-webcodecs'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Audiogram Maker, Waveform Video from Audio | EditToolbelt',
    description:
      'Make an audiogram: a waveform or spectrum animation over your image or a color, with a title and captions. Render 9:16, 1:1 or 16:9 video in your browser.',
    h1: 'Audiogram Maker',
    primaryQuery: 'audiogram maker',
    secondaryQueries: ['mp3 to mp4 with image'],
  },
  related: ['transcribe-audio', 'trim-audio', 'resize-video'],
  willDo: [
    'Animate a waveform or spectrum over a background image or a color',
    'Add a title, and captions from Transcribe Audio',
    'Render 9:16, 1:1 or 16:9 video in your browser',
  ],
});
