'use client';

import dynamic from 'next/dynamic';

import type { ViewIds } from '../ids';
import { viewIndex } from './view-index';

/** The video tools' views, by id (`VIEW_IDS.video` in ../ids.ts). */
export default viewIndex<ViewIds<'video'>>({
  'auto-subtitles': dynamic(() => import('../auto-subtitles')),
  'burn-subtitles': dynamic(() => import('../burn-subtitles')),
  'compress-video': dynamic(() => import('../compress-video')),
  'extract-audio': dynamic(() => import('../extract-audio')),
  'extract-frames': dynamic(() => import('../extract-frames')),
  'gif-to-mp4': dynamic(() => import('../gif-to-mp4')),
  'merge-videos': dynamic(() => import('../merge-videos')),
  'mute-video': dynamic(() => import('../mute-video')),
  'replace-audio': dynamic(() => import('../replace-audio')),
  'resize-video': dynamic(() => import('../resize-video')),
  'rotate-video': dynamic(() => import('../rotate-video')),
  'trim-video': dynamic(() => import('../trim-video')),
  'upscale-video': dynamic(() => import('../upscale-video')),
  'vfr-to-cfr': dynamic(() => import('../vfr-to-cfr')),
  'video-background-remover': dynamic(() => import('../video-background-remover')),
  'video-converter': dynamic(() => import('../video-converter')),
  'video-info': dynamic(() => import('../video-info')),
  'video-speed': dynamic(() => import('../video-speed')),
  'video-to-gif': dynamic(() => import('../video-to-gif')),
});
