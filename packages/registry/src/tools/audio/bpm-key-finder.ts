import { defineTool } from '../../define';

export default defineTool({
  id: 'bpm-key-finder',
  code: 'A03',
  slug: 'bpm-key-finder',
  category: 'audio',
  name: 'BPM & Key Finder',
  tagline: "Find a song's BPM and key, with Camelot notation, plus tap tempo and a metronome.",
  summary: 'Tempo, key, Camelot, tap tempo',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'analyzer',
  batch: false,
  accepts: ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac'],
  outputs: ['csv', 'txt'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 30 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'BPM Finder, Get Tempo and Key in Seconds | EditToolbelt',
    description:
      'Drop a song to get its tempo in BPM and its key in Camelot notation, each with a confidence score. Tap tempo, a metronome and beat marker export included.',
    h1: 'BPM Finder',
    primaryQuery: 'bpm finder',
    secondaryQueries: [
      'find key of song',
      'song key and bpm finder',
      'tap tempo',
      'online metronome',
    ],
    howTo: [
      'Drop a song: MP3, WAV, FLAC, OGG or M4A.',
      'The tempo, the key and its Camelot code appear in a few seconds, each with how sure it is.',
      'If the tempo is off by half or double, pick a tempo range and it runs again.',
      'Download the beat markers to cut to the beat, or tap along and run the metronome.',
    ],
    faq: [
      {
        q: 'How does it find the BPM?',
        a: 'It measures how the sound changes over time, which peaks where drums and notes start, then finds the beat period that repeats most. Half and double tempo are listed too, since a song at 70 BPM can feel like 140.',
      },
      {
        q: 'How does it find the key?',
        a: 'It adds up how much of each of the 12 notes the song holds and compares that with the typical shape of major and minor keys. A relative key (C major and A minor) or one a fifth away is the usual near miss, and those mix well anyway.',
      },
      {
        q: 'What is the Camelot code?',
        a: 'DJs number keys on a wheel: 8A is A minor, 8B is C major. Tracks with the same number, or one apart, mix without clashing.',
      },
      {
        q: 'What are beat markers?',
        a: 'A list of the time of every beat, as CSV or plain text, for placing cuts on the beat in your editor.',
      },
      {
        q: 'Is my song uploaded?',
        a: 'No. It is analysed in your browser.',
      },
    ],
  },
  related: ['change-pitch', 'stem-splitter', 'trim-audio'],
  willDo: [
    'Detect BPM and musical key with a confidence score, in a few seconds for a 4-minute song on desktop',
    'Show the key in Camelot notation for DJs, and half or double tempo alternatives',
    'Tap tempo, run a metronome, and export beat markers as CSV or TXT to cut to the beat',
  ],
});
