import { defineTool } from '../../define';

export default defineTool({
  id: 'resize-video',
  code: 'V09',
  slug: 'resize-video',
  category: 'video',
  name: 'Resize & Crop Video for Social',
  tagline: 'Reframe a video to 9:16, 1:1, 4:5 or 16:9 for Reels, TikTok, Shorts and YouTube.',
  summary: '9:16, 1:1, 4:5 or 16:9, cropped or fitted',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['mp4', 'mov', 'webm', 'mkv'],
  limits: { client: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Resize Video for Instagram, 9:16, 4:5 or 1:1 | EditToolbelt',
    description:
      'Reframe video to 9:16, 1:1, 4:5 or 16:9. Crop to fill with draggable framing, or fit on a blurred or solid color background. Presets for Reels and Shorts.',
    h1: 'Resize Video for Instagram',
    primaryQuery: 'resize video for instagram',
    secondaryQueries: ['convert video to 9:16', 'make video vertical'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'Pick a size: 9:16 for Reels, TikTok and Shorts, 4:5 or 1:1 for Instagram, 16:9 for YouTube, or your own in px.',
      'Fill crops to the new shape: slide the framing to keep the subject in frame. Or fit the whole picture on a blurred copy of itself or a color.',
      'Resize it and download it in the same format.',
    ],
    faq: [
      {
        q: 'How do I make a landscape video vertical?',
        a: 'Pick Reels, TikTok, Shorts (1080 × 1920). Fill crops a 9:16 window out of the middle: move Framing across to follow the subject. Fit on blur keeps the whole picture, with a blurred copy behind it top and bottom.',
      },
      {
        q: 'Does it lose quality?',
        a: 'The video is re-encoded once at high quality; the sound is copied. A video smaller than the size you pick is enlarged, and the notes say so, as it can look soft.',
      },
      {
        q: 'Can the framing follow the subject as it moves?',
        a: 'Not yet: the framing is fixed for the whole video. Trim the video into parts first if the subject moves a lot.',
      },
    ],
  },
  related: ['rotate-video', 'compress-video', 'aspect-ratio-calculator'],
  willDo: [
    'Reframe to 9:16, 1:1, 4:5 or 16:9, or set an exact resolution',
    'Crop to fill with draggable framing, or fit on a blurred or solid color background',
    'Start from presets: Reels, TikTok and Shorts 1080×1920, Instagram 1080×1350 and 1080×1080, YouTube 1920×1080',
  ],
});
