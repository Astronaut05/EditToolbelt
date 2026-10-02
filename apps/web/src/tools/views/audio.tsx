'use client';

import dynamic from 'next/dynamic';

import type { ViewIds } from '../ids';
import { viewIndex } from './view-index';

/** The audio tools' views, by id (`VIEW_IDS.audio` in ../ids.ts). */
export default viewIndex<ViewIds<'audio'>>({
  'audio-channels': dynamic(() => import('../audio-channels')),
  'audio-converter': dynamic(() => import('../audio-converter')),
  'bpm-key-finder': dynamic(() => import('../bpm-key-finder')),
  'change-pitch': dynamic(() => import('../change-pitch')),
  'fade-audio': dynamic(() => import('../fade-audio')),
  'loudness-meter': dynamic(() => import('../loudness-meter')),
  'merge-audio': dynamic(() => import('../merge-audio')),
  'normalize-audio': dynamic(() => import('../normalize-audio')),
  'remove-noise': dynamic(() => import('../remove-noise')),
  'remove-silence': dynamic(() => import('../remove-silence')),
  'reverse-audio': dynamic(() => import('../reverse-audio')),
  'split-audio': dynamic(() => import('../split-audio')),
  'transcribe-audio': dynamic(() => import('../transcribe-audio')),
  'trim-audio': dynamic(() => import('../trim-audio')),
});
