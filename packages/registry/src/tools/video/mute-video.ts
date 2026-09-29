import { defineTool } from '../../define';

export default defineTool({
  id: 'mute-video',
  code: 'V07',
  slug: 'mute-video',
  category: 'video',
  name: 'Mute Video',
  tagline: 'Remove the sound from a video in an instant, with the picture left exactly as it was.',
  summary: 'Instant, with no re-encode of the picture',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Remove Audio from Video, Instant and Lossless | EditToolbelt',
    description:
      'Strip the audio track from a video by stream copy, so it is instant and the picture stays byte for byte the same. Or mute just one range of the clip.',
    h1: 'Remove Audio from Video',
    primaryQuery: 'remove audio from video',
    secondaryQueries: ['mute video'],
  },
  related: ['replace-audio', 'extract-audio', 'trim-video'],
  willDo: [
    'Remove the audio track by stream copy, which is instant',
    'Leave the video stream byte for byte the same, with no re-encode',
    'Mute only a range instead, re-encoding the audio and nothing else',
  ],
});
