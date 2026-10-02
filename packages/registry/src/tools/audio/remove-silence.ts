import { defineTool } from '../../define';

export default defineTool({
  id: 'remove-silence',
  code: 'A11',
  slug: 'remove-silence',
  category: 'audio',
  name: 'Remove Silence',
  tagline: 'Cut or shorten the pauses in voiceovers, podcasts and lectures, and export the cuts.',
  summary: 'Cut pauses, export a cut list',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'timeline',
  batch: false,
  accepts: ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac'],
  outputs: ['wav', 'flac', 'mp3', 'm4a', 'ogg', 'csv'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Remove Silence from Audio, Auto Cut Pauses | EditToolbelt',
    description:
      'Find the silent pauses in a voiceover or podcast, then remove or shorten them. Export the cuts as a CSV marker list to make the same edit in your video.',
    h1: 'Remove Silence from Audio',
    primaryQuery: 'remove silence from audio',
    secondaryQueries: ['cut silence podcast', 'auto cut silences'],
    howTo: [
      'Drop a recording: MP3, WAV, FLAC, OGG or M4A. The silences are found as it loads and shown on the timeline.',
      'Leave the threshold on Auto, or set it in dBFS, and set how long a pause has to be to count. The timeline updates as you change them.',
      'Remove each pause, keeping a little quiet beside the sound, or shorten each one to a set length.',
      'Each range on the timeline is a cut: drag its edges, or select it and remove it to keep that pause.',
      'Download the shorter audio, or the cut list as CSV to make the same cuts to your video.',
    ],
    faq: [
      {
        q: 'How does Auto set the threshold?',
        a: 'The level is read every 10 ms. Auto takes the level the quietest tenth of the recording sits at, the noise floor, and sets the threshold 10 dB above it, between −60 and −30 dBFS. Anything quieter than that for at least the minimum length is a silence.',
      },
      {
        q: 'Why keep some quiet beside the sound?',
        a: 'Cutting right up to a word clips its breath and its tail, and the speech sounds rushed. 0.1 s either side keeps it natural. Each join gets a 10 ms crossfade, so there is no click.',
      },
      {
        q: 'What is in the CSV?',
        a: 'One row per cut: its number, start and end as hh:mm:ss.mmm, its length, and the start and end in seconds. Use it as a marker list to make the same cuts to the video the audio came from.',
      },
      {
        q: 'Does it lower the quality?',
        a: 'WAV and FLAC stay lossless. MP3, M4A and OGG are encoded again at their own bitrate. Choose WAV to avoid it.',
      },
    ],
  },
  related: ['trim-audio', 'normalize-audio', 'remove-noise'],
  willDo: [
    'Find silences below a dBFS threshold, or set the threshold from the noise floor',
    'Remove each pause or shorten it to a length you set, and turn single cuts on or off',
    'Export the cuts as a CSV marker list to make the same edit in your video',
  ],
});
