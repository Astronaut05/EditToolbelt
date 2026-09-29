import { defineTool } from '../../define';

export default defineTool({
  id: 'video-speed',
  code: 'V13',
  slug: 'video-speed',
  category: 'video',
  name: 'Change Video Speed',
  tagline: 'Speed up or slow down a video from 0.25× to 4×, with the audio pitch kept natural.',
  summary: '0.25× to 4×, audio pitch preserved',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Speed Up Video, or Slow It Down to 0.25× | EditToolbelt',
    description:
      'Speed up or slow down a video from 0.25× to 4×, or enter a custom speed. Keep the audio pitch, let it shift, or mute the sound. Free in your browser.',
    h1: 'Speed Up Video',
    primaryQuery: 'speed up video',
    secondaryQueries: ['slow down video', 'change video speed'],
  },
  related: ['trim-video', 'reverse-video', 'change-pitch'],
  willDo: [
    'Set any speed from 0.25× to 4×, or enter a custom value',
    'Keep the audio pitch unchanged, let it shift with the speed, or mute the sound',
    'Process the video in your browser, so it is never uploaded',
  ],
});
