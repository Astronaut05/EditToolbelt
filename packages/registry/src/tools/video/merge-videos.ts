import { defineTool } from '../../define';

export default defineTool({
  id: 'merge-videos',
  code: 'V12',
  slug: 'merge-videos',
  category: 'video',
  name: 'Merge Videos',
  tagline: 'Join clips in the order you set, without re-encoding when they share the same specs.',
  summary: 'Join clips in order, fast when specs match',
  status: 'beta',
  wave: 2,
  // The browser path, and ffmpeg on our servers for large totals once an admin switches it on.
  runtime: 'hybrid',
  engines: ['video-webcodecs', 'video-ffmpeg-server'],
  ui: 'form',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['mp4', 'mov', 'webm', 'mkv'],
  limits: {
    // The clips together: the joined file is built in memory.
    client: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 },
    // The clips together on our servers; each clip also fits on its own (its upload).
    server: {
      free: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 },
      paid: { maxBytes: 10 * 1024 ** 3, maxDurationSec: 4 * 60 * 60 },
    },
    // A stream copy takes minutes; re-encoding 4 h at 1080p takes about 1 h on one core.
    timeoutSec: 2 * 60 * 60,
    maxConcurrent: 2,
  },
  // Priced on the clips' total length, from the server's probe.
  cost: { kind: 'perMinute', credits: 1, minCredits: 1 },
  surfaces: ['web', 'api'],
  seo: {
    title: 'Merge Videos, Join Clips in Any Order | EditToolbelt',
    description:
      'Join video clips in the order you choose. Clips with the same codec, resolution and fps join fast in your browser. Mixed clips are re-encoded to one spec.',
    h1: 'Merge Videos',
    primaryQuery: 'merge videos',
    secondaryQueries: ['combine videos', 'join mp4 files'],
    howTo: [
      'Drop two or more clips, up to 2 GB in all: MP4, MOV, WebM or MKV. Add more with Add files.',
      'Put them in order with the arrows, or remove one.',
      'Pick a cut or a crossfade between clips, and the size and frame rate if you want other than the first clip’s.',
      'Merge and download. Clips that share their codec and settings are joined without re-encoding.',
    ],
    faq: [
      {
        q: 'When is it fast and lossless?',
        a: 'When every clip has the same codec, encoder settings and size, such as clips from one camera or phone, and you keep the cut and the first clip’s size and frame rate. Then every packet is copied as it is: nothing is re-encoded and it takes seconds.',
      },
      {
        q: 'What happens with mixed clips?',
        a: 'They are re-encoded to one spec: the first clip’s size and frame rate, or ones you pick. Each frame is drawn on a steady clock, so 25 and 30 fps clips play at the right speed with no drift, and clips of another shape are fitted on black. Each clip’s sound stays with its picture.',
      },
      {
        q: 'Can I add a crossfade?',
        a: 'Yes: 0.5, 1 or 2 s between every pair of clips. The picture dissolves and the sound crossfades; each crossfade shortens the result by its length. A crossfade means re-encoding.',
      },
      {
        q: 'Are my clips uploaded?',
        a: 'No. They are joined in this browser and never leave your device, unless you choose our servers for a very large set.',
      },
    ],
  },
  related: ['trim-video', 'vfr-to-cfr', 'compress-video'],
  willDo: [
    'Join clips in the order you set, fast and without re-encoding when codec, resolution and fps match',
    "Re-encode mixed clips to one common spec: the first clip's, or one you choose",
    'Add a crossfade between clips, or join them with no transition',
  ],
});
