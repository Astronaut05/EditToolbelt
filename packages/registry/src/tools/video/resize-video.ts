import { defineTool } from '../../define';

export default defineTool({
  id: 'resize-video',
  code: 'V09',
  slug: 'resize-video',
  category: 'video',
  name: 'Resize & Crop Video for Social',
  tagline: 'Reframe a video to 9:16, 1:1, 4:5 or 16:9 for Reels, TikTok, Shorts and YouTube.',
  summary: '9:16, 1:1, 4:5 or 16:9, cropped or fitted',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Resize Video for Instagram, 9:16, 4:5 or 1:1 | EditToolbelt',
    description:
      'Reframe video to 9:16, 1:1, 4:5 or 16:9. Crop to fill with draggable framing, or fit on a blurred or solid color background. Presets for Reels and Shorts.',
    h1: 'Resize Video for Instagram',
    primaryQuery: 'resize video for instagram',
    secondaryQueries: ['convert video to 9:16', 'make video vertical'],
  },
  related: ['rotate-video', 'compress-video', 'aspect-ratio-calculator'],
  willDo: [
    'Reframe to 9:16, 1:1, 4:5 or 16:9, or set an exact resolution',
    'Crop to fill with draggable framing, or fit on a blurred or solid color background',
    'Start from presets: Reels, TikTok and Shorts 1080×1920, Instagram 1080×1350 and 1080×1080, YouTube 1920×1080',
  ],
});
