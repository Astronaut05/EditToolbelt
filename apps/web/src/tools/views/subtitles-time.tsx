'use client';

import dynamic from 'next/dynamic';

import type { ViewIds } from '../ids';
import { viewIndex } from './view-index';

/** The subtitles and time tools' views, by id (`VIEW_IDS['subtitles-time']` in ../ids.ts). */
export default viewIndex<ViewIds<'subtitles-time'>>({
  'aspect-ratio-calculator': dynamic(() => import('../aspect-ratio-calculator')),
  'bitrate-calculator': dynamic(() => import('../bitrate-calculator')),
  'shutter-angle-calculator': dynamic(() => import('../shutter-angle-calculator')),
  'storage-calculator': dynamic(() => import('../storage-calculator')),
  'subtitle-converter': dynamic(() => import('../subtitle-converter')),
  'subtitle-editor': dynamic(() => import('../subtitle-editor')),
  'subtitle-shift': dynamic(() => import('../subtitle-shift')),
  'timecode-calculator': dynamic(() => import('../timecode-calculator')),
});
