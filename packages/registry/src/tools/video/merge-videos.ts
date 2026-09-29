import { defineTool } from '../../define';

export default defineTool({
  id: 'merge-videos',
  code: 'V12',
  slug: 'merge-videos',
  category: 'video',
  name: 'Merge Videos',
  tagline: 'Join clips in the order you set, without re-encoding when they share the same specs.',
  summary: 'Join clips in order, fast when specs match',
  status: 'soon',
  wave: 2,
  runtime: 'hybrid',
  engines: ['video-webcodecs', 'video-ffmpeg-server'],
  ui: 'batch',
  batch: true,
  cost: { kind: 'perMinute', credits: 1, minCredits: 1 },
  surfaces: ['web', 'api'],
  seo: {
    title: 'Merge Videos, Join Clips in Any Order | EditToolbelt',
    description:
      'Join video clips in the order you choose. Clips with the same codec, resolution and fps join fast in your browser. Mixed clips are re-encoded to one spec.',
    h1: 'Merge Videos',
    primaryQuery: 'merge videos',
    secondaryQueries: ['combine videos', 'join mp4 files'],
  },
  related: ['trim-video', 'vfr-to-cfr', 'compress-video'],
  willDo: [
    'Join clips in the order you set, fast and without re-encoding when codec, resolution and fps match',
    "Re-encode mixed clips to one common spec: the first clip's, or one you choose",
    'Add a crossfade between clips, or join them with no transition',
  ],
});
