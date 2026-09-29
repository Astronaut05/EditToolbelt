import audioChannels from './audio-channels';
import audioConverter from './audio-converter';
import audioToVideo from './audio-to-video';
import bpmKeyFinder from './bpm-key-finder';
import changePitch from './change-pitch';
import fadeAudio from './fade-audio';
import loudnessMeter from './loudness-meter';
import mergeAudio from './merge-audio';
import normalizeAudio from './normalize-audio';
import removeNoise from './remove-noise';
import removeSilence from './remove-silence';
import reverseAudio from './reverse-audio';
import splitAudio from './split-audio';
import stemSplitter from './stem-splitter';
import transcribeAudio from './transcribe-audio';
import trimAudio from './trim-audio';

export default [
  audioConverter,
  trimAudio,
  bpmKeyFinder,
  mergeAudio,
  normalizeAudio,
  loudnessMeter,
  fadeAudio,
  changePitch,
  stemSplitter,
  removeNoise,
  removeSilence,
  transcribeAudio,
  audioChannels,
  splitAudio,
  reverseAudio,
  audioToVideo,
];
