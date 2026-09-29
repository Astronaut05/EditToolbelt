import { defineTool } from '../../define';

export default defineTool({
  id: 'trim-audio',
  code: 'A02',
  slug: 'trim-audio',
  category: 'audio',
  name: 'Trim Audio',
  tagline: 'Cut the start, the end or any range out of an audio file, with fades at the edges.',
  summary: 'Cut ranges, fade the edges',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'timeline',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Trim Audio, Cut MP3 or WAV to the Millisecond | EditToolbelt',
    description:
      'Cut the start and end of an MP3, WAV or FLAC, or remove ranges from the middle. Sample-accurate cuts, and WAV or FLAC stay lossless. Free in your browser.',
    h1: 'Trim Audio',
    primaryQuery: 'trim audio',
    secondaryQueries: ['cut mp3', 'audio cutter'],
  },
  related: ['fade-audio', 'remove-silence', 'audio-converter'],
  willDo: [
    'Keep or remove one or many ranges on a waveform timeline, cut to the exact sample',
    'Set fade in and fade out lengths, with a 5 ms fade on every cut to avoid clicks',
    'Save WAV and FLAC as a lossless copy, or export to another format',
  ],
});
