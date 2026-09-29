import { defineTool } from '../../define';

export default defineTool({
  id: 'loop-video',
  code: 'V19',
  slug: 'loop-video',
  category: 'video',
  name: 'Loop Video',
  tagline: 'Repeat a clip a set number of times or up to a target length, or make a boomerang.',
  summary: 'Repeat N times, to a length, or boomerang',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Loop Video, Repeat a Clip or Make a Boomerang | EditToolbelt',
    description:
      'Repeat a video N times or until it reaches a target length, or play it forward then backward as a boomerang. Joins without re-encoding when it can.',
    h1: 'Loop Video',
    primaryQuery: 'loop video',
    secondaryQueries: [],
  },
  related: ['reverse-video', 'gif-to-mp4', 'video-to-gif'],
  willDo: [
    'Repeat a clip N times, or until it reaches a target duration',
    'Make a boomerang that plays forward, then backward',
    'Join the copies without re-encoding when possible, so it is fast',
  ],
});
