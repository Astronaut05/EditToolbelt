import { defineTool } from '../../define';

export default defineTool({
  id: 'rotate-video',
  code: 'V11',
  slug: 'rotate-video',
  category: 'video',
  name: 'Rotate & Flip Video',
  tagline: 'Turn a video 90°, 180° or 270°, or flip it, so sideways phone clips play upright.',
  summary: '90°, 180° or 270°, plus flips',
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
    title: 'Rotate Video, Fix Sideways Phone Clips | EditToolbelt',
    description:
      'Rotate a video 90°, 180° or 270°, or flip it. Fast mode sets the rotation flag instantly. Burn in re-encodes for players that ignore the flag.',
    h1: 'Rotate Video',
    primaryQuery: 'rotate video',
    secondaryQueries: ['flip video'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'Pick a turn (90° right, 180°, 90° left) and, if you need one, a flip: mirror or upside down.',
      'Keep Turn every frame to play turned everywhere, or choose Fast to only set the rotation flag, instantly and losslessly.',
      'Rotate it and download it in the same format.',
    ],
    faq: [
      {
        q: 'Fast or Turn every frame?',
        a: 'Fast writes a flag in the file saying how to turn the picture: instant, with nothing re-encoded, and phones, players and editing apps follow it. A few web players and older apps ignore it and show the video sideways. Turn every frame re-encodes the video at high quality so it is upright everywhere.',
      },
      {
        q: 'Why is my phone video sideways in one app and upright in another?',
        a: 'Phones record landscape frames and set a rotation flag for portrait. Apps that ignore the flag show it sideways. Turning every frame here removes the need for the flag.',
      },
      {
        q: 'Does the sound change?',
        a: 'No. The sound is copied as it is, and the length stays the same.',
      },
    ],
  },
  related: ['resize-video', 'trim-video', 'video-info'],
  willDo: [
    'Rotate 90°, 180° or 270°, and flip the picture',
    'Fast mode sets the rotation flag instantly, and most players follow it',
    'Burn in re-encodes for players that ignore the flag, and is the default for 90°',
  ],
});
