import { defineTool } from '../../define';

export default defineTool({
  id: 'mute-video',
  code: 'V07',
  slug: 'mute-video',
  category: 'video',
  name: 'Mute Video',
  tagline: 'Remove the sound from a video in an instant, with the picture left exactly as it was.',
  summary: 'Instant, with no re-encode of the picture',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'timeline',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['mp4', 'mov', 'webm', 'mkv'],
  limits: { client: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Remove Audio from Video, Instant and Lossless | EditToolbelt',
    description:
      'Strip the audio track from a video by stream copy, so it is instant and the picture stays byte for byte the same. Or mute just one range of the clip.',
    h1: 'Remove Audio from Video',
    primaryQuery: 'remove audio from video',
    secondaryQueries: ['mute video'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'Keep All the audio to remove the sound, or pick The selection and drag In and Out over the part to silence.',
      'Select Mute. Removing all the audio takes a moment, even for a long video.',
      'Download the video. It keeps its format, and the picture is exactly as it was.',
    ],
    faq: [
      {
        q: 'Does removing the audio lower the video quality?',
        a: 'No. The picture is copied packet for packet, with no re-encode, so it is byte for byte the same. That is also why it is instant.',
      },
      {
        q: 'Can I mute just a swear word or a noisy part?',
        a: 'Yes. Pick The selection, set In and Out around it, and only that part goes silent, with short fades so there is no click. The rest of the sound stays; it is re-encoded, and the picture still is not.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. It is read and written in your browser, up to 2 GB.',
      },
    ],
  },
  related: ['replace-audio', 'extract-audio', 'trim-video'],
  willDo: [
    'Remove the audio track by stream copy, which is instant',
    'Leave the video stream byte for byte the same, with no re-encode',
    'Mute only a range instead, re-encoding the audio and nothing else',
  ],
});
