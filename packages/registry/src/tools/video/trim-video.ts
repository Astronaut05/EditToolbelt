import { defineTool } from '../../define';

export default defineTool({
  id: 'trim-video',
  code: 'V01',
  slug: 'trim-video',
  category: 'video',
  name: 'Trim Video',
  tagline: 'Cut the start and end of a video: keyframe-fast with no quality loss, or frame-exact.',
  summary: 'Keyframe-fast or frame-exact',
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
    title: 'Trim Video, Fast Cuts with No Quality Loss | EditToolbelt',
    description:
      'Cut the start and end of an MP4, MOV or WebM in your browser. Fast mode copies the streams with no quality loss; Precise mode cuts on the exact frame.',
    h1: 'Trim Video',
    primaryQuery: 'trim video',
    secondaryQueries: ['cut video online', 'cut mp4', 'video cutter no watermark'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV, up to 2 GB.',
      'Drag the In and Out handles on the timeline, or type the times. I and O set them at the playhead.',
      'Keep Fast for an instant cut with no quality loss, or pick Precise to cut on the exact frame.',
      'Select Trim, then download the clip. There’s no watermark.',
    ],
    faq: [
      {
        q: 'What’s the difference between Fast and Precise?',
        a: 'Fast copies the video as it is, so it takes a moment and loses nothing, but a video can only start on a keyframe: the cut may begin up to a couple of seconds before your In point, and the result tells you where. Precise re-encodes the video so it starts and ends on the exact frames you chose.',
      },
      {
        q: 'Does it add a watermark?',
        a: 'No. The video is cut on your device and saved as it is, with no watermark and no sign-up.',
      },
      {
        q: 'Which formats can I trim?',
        a: 'MP4, MOV, WebM and MKV. Fast mode keeps the format you dropped. Precise mode writes MP4 where the browser can encode H.264, which Chrome, Edge and Safari can, and WebM otherwise.',
      },
      {
        q: 'Can I cut out several parts and join the rest?',
        a: 'Not yet. For now it keeps one range, from In to Out. Keeping or removing several ranges and joining them is coming next.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. Trimming runs in your browser with its own video decoder and encoder, so the file never leaves your device.',
      },
    ],
  },
  related: ['merge-videos', 'compress-video', 'video-to-gif'],
  willDo: [
    'Set in and out points on a timeline, or type them to the millisecond',
    'Fast mode snaps to the nearest keyframes and copies the streams, with no re-encode',
    'Precise mode re-encodes for cuts on the exact frame you choose',
  ],
});
