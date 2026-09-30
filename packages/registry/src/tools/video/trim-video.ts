import { defineTool } from '../../define';

export default defineTool({
  id: 'trim-video',
  code: 'V01',
  slug: 'trim-video',
  category: 'video',
  name: 'Trim Video',
  tagline: 'Cut a video or join several parts: keyframe-fast and lossless, or frame-exact.',
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
      'Cut an MP4, MOV or WebM in your browser, or join several parts. Fast mode copies the streams with no quality loss; Precise mode cuts on the exact frame.',
    h1: 'Trim Video',
    primaryQuery: 'trim video',
    secondaryQueries: ['cut video online', 'cut mp4', 'video cutter no watermark'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV, up to 2 GB.',
      'Drag the In and Out handles on the timeline, or type the times. I and O set them at the playhead. Add range for more parts; keep them, or remove them and join what’s left.',
      'Keep Fast for an instant cut with no quality loss, or pick Precise to cut on the exact frame.',
      'Select Trim, then download the clip. There’s no watermark.',
    ],
    faq: [
      {
        q: 'What’s the difference between Fast and Precise?',
        a: 'Fast copies the video as it is, so it takes a moment and loses nothing, but a video can only start on a keyframe: each part may begin up to a couple of seconds before its In point, and the result tells you where. Precise cuts on the exact frames you chose. For WebM and MKV (VP8, VP9) it re-encodes only the frames from each cut to the next keyframe and copies the rest; other videos are re-encoded in full.',
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
        a: 'Yes. Select Add range for each part, then keep them, or remove them and join what’s left. The parts play one after another, and the sound crossfades over 10 ms at each join so it doesn’t click.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. Trimming runs in your browser with its own video decoder and encoder, so the file never leaves your device.',
      },
    ],
  },
  related: ['merge-videos', 'compress-video', 'video-to-gif'],
  willDo: [
    'Set in and out points on a timeline or type them; keep or remove several ranges and join them',
    'Fast mode snaps to the nearest keyframes and copies the streams, with no re-encode',
    'Precise mode cuts on the exact frame, re-encoding only the frames at the cuts for WebM and MKV',
  ],
});
