import { defineTool } from '../../define';

export default defineTool({
  id: 'replace-audio',
  code: 'V14',
  slug: 'replace-audio',
  category: 'video',
  name: 'Add or Replace Audio in Video',
  tagline: "Swap a video's soundtrack, or mix music under the original sound with fades.",
  summary: 'Replace the soundtrack or mix in music',
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
  surfaces: ['web'],
  seo: {
    title: 'Add Music to Video, Replace or Mix with Fades | EditToolbelt',
    description:
      "Replace a video's soundtrack, or mix a music bed under the original audio. Set levels, fades and a start offset. Music is trimmed or looped to fit.",
    h1: 'Add Music to Video',
    primaryQuery: 'add music to video',
    secondaryQueries: ['replace audio in video'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'Choose the music or sound to add: MP3, WAV, FLAC, OGG or M4A.',
      'Replace the video’s sound with it, or keep the video’s sound and put the music under it. Set each level.',
      'Set the fades, where in the music to start, and whether to loop it if it’s shorter than the video.',
      'Add the sound and download the video. The picture is copied as it is, never re-encoded.',
    ],
    faq: [
      {
        q: 'What level should music under speech be?',
        a: 'About 15 dB under the voice is a common start: the default in Mix is −15 dB for the music and 0 dB for the video’s sound. Go to −18 or −24 dB if the words get hard to follow, or −9 dB for music that carries the scene.',
      },
      {
        q: 'What if the music is longer or shorter than the video?',
        a: 'Longer music is cut at the video’s end, with the fade out (2 s by default) ending there. Shorter music loops from its start, with a 10 ms dip at each repeat so there’s no click, or plays once and stops.',
      },
      {
        q: 'Does it lower the video’s quality?',
        a: 'No. The picture is copied packet for packet. Only the sound is new: AAC in MP4 and MOV, Opus in WebM and MKV, at 48 kHz and 192 kbps for stereo.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. The video and the music are read and joined in this browser; neither leaves your device.',
      },
    ],
  },
  related: ['mute-video', 'extract-audio', 'normalize-audio'],
  willDo: [
    'Replace the soundtrack, or mix a music bed under the original audio',
    'Set levels, fade in and out, and where the music starts',
    'Trim or loop the music to match the video length',
  ],
});
