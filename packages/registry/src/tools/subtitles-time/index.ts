import aspectRatioCalculator from './aspect-ratio-calculator';
import bitrateCalculator from './bitrate-calculator';
import shutterAngleCalculator from './shutter-angle-calculator';
import storageCalculator from './storage-calculator';
import subtitleConverter from './subtitle-converter';
import subtitleEditor from './subtitle-editor';
import subtitleShift from './subtitle-shift';
import timecodeCalculator from './timecode-calculator';

export default [
  subtitleConverter,
  subtitleShift,
  subtitleEditor,
  timecodeCalculator,
  aspectRatioCalculator,
  bitrateCalculator,
  shutterAngleCalculator,
  storageCalculator,
];
