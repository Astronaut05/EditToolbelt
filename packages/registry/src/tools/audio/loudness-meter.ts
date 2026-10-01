import { defineTool } from '../../define';

export default defineTool({
  id: 'loudness-meter',
  code: 'A06',
  slug: 'loudness-meter',
  category: 'audio',
  name: 'Loudness Meter',
  tagline: 'Measure integrated LUFS, true peak and loudness range, and check platform targets.',
  summary: 'LUFS, true peak, LRA, pass or fail',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'analyzer',
  batch: false,
  accepts: [
    '.mp3',
    '.wav',
    '.flac',
    '.ogg',
    '.oga',
    '.opus',
    '.m4a',
    '.aac',
    'video/mp4',
    'video/quicktime',
    'video/webm',
  ],
  outputs: ['txt', 'csv'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'LUFS Meter Online, Check True Peak and LRA | EditToolbelt',
    description:
      'Read integrated, short-term and momentary LUFS, loudness range, true peak and RMS of your audio, with pass or fail against platform loudness targets.',
    h1: 'LUFS Meter Online',
    primaryQuery: 'lufs meter online',
    secondaryQueries: ['check audio loudness', 'true peak meter'],
    howTo: [
      'Drop an audio file, or a video to measure its sound.',
      'The integrated loudness, true peak and loudness range appear in seconds, with a graph of the loudness over time.',
      'Check the verdicts for YouTube, Spotify, Apple Music, podcasts, EBU R128 and US TV.',
      'Download the report, or the loudness every 100 ms as a CSV.',
    ],
    faq: [
      {
        q: 'What is LUFS?',
        a: 'Loudness Units relative to Full Scale: how loud audio sounds, not just how high its peaks go. It weights the frequencies the ear hears most and leaves out the silent parts. One LU is one decibel.',
      },
      {
        q: 'What is true peak?',
        a: 'The highest level of the actual waveform, including between the samples, where a peak can sit higher than any sample. It is measured by oversampling four times. Keep it under −1 dBTP so conversion to MP3 or AAC does not clip.',
      },
      {
        q: 'How accurate is it?',
        a: 'It follows ITU-R BS.1770-4 and EBU R128, and it is checked against the EBU’s test signals and the open-source pyloudnorm meter, within 0.1 LU.',
      },
      {
        q: 'What do the platform verdicts mean?',
        a: 'Streaming services play everything at about the same loudness: louder audio is turned down, so there is no gain in mastering hotter. Broadcast and podcast specs must be met within their tolerance, with the true peak under their limit.',
      },
    ],
  },
  related: ['normalize-audio', 'extract-audio', 'remove-noise'],
  willDo: [
    'Read integrated LUFS, short-term max, momentary max, loudness range, true peak and RMS',
    'See pass or fail against the loudness targets of each platform',
    'Follow loudness over time on a graph to find the loud and quiet parts',
  ],
});
