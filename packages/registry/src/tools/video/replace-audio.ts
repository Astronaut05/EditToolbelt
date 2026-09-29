import { defineTool } from '../../define';

export default defineTool({
  id: 'replace-audio',
  code: 'V14',
  slug: 'replace-audio',
  category: 'video',
  name: 'Add or Replace Audio in Video',
  tagline: "Swap a video's soundtrack, or mix music under the original sound with fades.",
  summary: 'Replace the soundtrack or mix in music',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Add Music to Video, Replace or Mix with Fades | EditToolbelt',
    description:
      "Replace a video's soundtrack, or mix a music bed under the original audio. Set levels, fades and a start offset. Music is trimmed or looped to fit.",
    h1: 'Add Music to Video',
    primaryQuery: 'add music to video',
    secondaryQueries: ['replace audio in video'],
  },
  related: ['mute-video', 'extract-audio', 'normalize-audio'],
  willDo: [
    'Replace the soundtrack, or mix a music bed under the original audio',
    'Set levels, fade in and out, and where the music starts',
    'Trim or loop the music to match the video length',
  ],
});
