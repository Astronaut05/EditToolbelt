import { defineTool } from '../../define';

export default defineTool({
  id: 'compress-video',
  code: 'V02',
  slug: 'compress-video',
  category: 'video',
  name: 'Compress Video',
  tagline: 'Shrink a video to a set size like 8 MB or 25 MB, or to a quality level you pick.',
  summary: 'By target size, quality or preset',
  status: 'live',
  wave: 1,
  runtime: 'hybrid',
  engines: ['video-webcodecs', 'video-ffmpeg-server'],
  ui: 'form',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['mp4', 'webm'],
  limits: {
    client: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 },
    // The server path (M4), used once an admin switches it on.
    server: {
      free: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 },
      paid: { maxBytes: 10 * 1024 ** 3, maxDurationSec: 4 * 60 * 60 },
    },
  },
  cost: { kind: 'perMinute', credits: 1, minCredits: 2 },
  surfaces: ['web', 'mobile', 'api'],
  seo: {
    title: 'Compress Video, Fit Discord and Email Limits | EditToolbelt',
    description:
      'Shrink a video to 8, 10, 25, 50 or 100 MB, or by quality, or set resolution, fps and bitrate yourself. See the estimated size before you start.',
    h1: 'Compress Video',
    primaryQuery: 'compress video',
    secondaryQueries: ['compress video for discord', 'reduce video size', 'compress mp4'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV, up to 2 GB.',
      'Pick a size, such as 10 MB for Discord or 25 MB for email, or pick a quality instead.',
      'Leave Resolution on Auto to have it scale down only when the size needs it, or set it yourself.',
      'Select Compress, watch the result, and download it.',
    ],
    faq: [
      {
        q: 'How do I compress a video for Discord?',
        a: 'Pick 10 MB · Discord and select Compress. The file lands just under 10 MB, the limit for free accounts, and plays right in the chat.',
      },
      {
        q: 'Why did it make my video smaller in pixels?',
        a: 'A size target leaves a fixed number of bits for each second. When that is too few for the resolution, the picture turns blocky, so Auto steps down, 1080p to 720p for example, and says so. Choose Keep to hold the resolution anyway.',
      },
      {
        q: 'Which codec should I pick?',
        a: 'H.264 plays everywhere. H.265 and AV1 look better at the same size, but older devices may not play them, and not every browser can encode them; the tool falls back to H.264 and tells you when that happens.',
      },
      {
        q: 'Why is the result WebM?',
        a: 'Some browsers, such as Firefox on Linux, can’t encode H.264. Then the video is saved as WebM (VP9), which modern browsers, Discord and VLC play. Chrome, Edge and Safari make MP4.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. It is compressed on your device with your browser’s own encoder, so it never leaves your computer or phone.',
      },
    ],
  },
  related: ['trim-video', 'video-converter', 'bitrate-calculator'],
  willDo: [
    'Hit a target size of 8, 10, 25, 50 or 100 MB, labelled for Discord, email and WhatsApp',
    'Pick High, Medium or Small quality, or set resolution, fps, bitrate and codec yourself',
    'Show the estimated output before you start, and suggest a lower resolution when needed',
  ],
});
