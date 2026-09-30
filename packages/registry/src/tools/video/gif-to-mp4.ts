import { defineTool } from '../../define';

export default defineTool({
  id: 'gif-to-mp4',
  code: 'V05',
  slug: 'gif-to-mp4',
  category: 'video',
  name: 'GIF to MP4',
  tagline: 'Turn an animated GIF into a much smaller MP4 or WebM for social posts and the web.',
  summary: 'Much smaller files for social and web',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  accepts: ['image/gif', '.gif'],
  outputs: ['mp4', 'webm'],
  limits: { client: { maxBytes: 200 * 1024 ** 2, maxDurationSec: 10 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'GIF to MP4, Much Smaller Files for Social | EditToolbelt',
    description:
      'Convert an animated GIF to MP4 or WebM, much smaller for social posts and web pages. Frame timing is kept, and you choose loops and a background color.',
    h1: 'GIF to MP4',
    primaryQuery: 'gif to mp4',
    secondaryQueries: ['convert gif to video'],
    howTo: [
      'Drop an animated GIF.',
      'Keep MP4, which plays everywhere, or pick WebM.',
      'Pick how many times the animation plays, and a background for any transparent parts.',
      'Select Convert, then download the video.',
    ],
    faq: [
      {
        q: 'How much smaller is the MP4?',
        a: 'Usually several times smaller. GIF stores every frame as a picture with at most 256 colours; video codecs store only what changes between frames.',
      },
      {
        q: 'Is the timing kept?',
        a: 'Yes. Each frame lasts exactly as long as in the GIF, even when frames have different delays. Frames with no delay set play at 100 ms, as browsers show them.',
      },
      {
        q: 'What happens to transparency?',
        a: 'MP4 has no transparency, so transparent parts are filled with the background colour you pick. White is the default.',
      },
      {
        q: 'Why would I play it more than once?',
        a: 'Some sites don’t loop videos, and very short videos can be refused. Playing a 2 s GIF 3 times makes a 6 s video.',
      },
      {
        q: 'Is my GIF uploaded?',
        a: 'No. It is converted in your browser, up to 200 MB.',
      },
    ],
  },
  related: ['video-to-gif', 'loop-video', 'compress-video'],
  willDo: [
    'Convert an animated GIF to MP4 or WebM, much smaller for social posts and the web',
    'Repeat the animation a set number of times in the video',
    'Fill transparent areas with a background color you choose',
  ],
});
