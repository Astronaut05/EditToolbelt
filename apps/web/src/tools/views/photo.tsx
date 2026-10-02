'use client';

import dynamic from 'next/dynamic';

import type { ViewIds } from '../ids';
import { viewIndex } from './view-index';

/** The photo tools' views, by id (`VIEW_IDS.photo` in ../ids.ts). */
export default viewIndex<ViewIds<'photo'>>({
  'compress-image': dynamic(() => import('../compress-image')),
  'crop-image': dynamic(() => import('../crop-image')),
  'exif-remover': dynamic(() => import('../exif-remover')),
  'image-converter': dynamic(() => import('../image-converter')),
  'object-eraser': dynamic(() => import('../object-eraser')),
  'remove-background': dynamic(() => import('../remove-background')),
  'resize-image': dynamic(() => import('../resize-image')),
  'rotate-image': dynamic(() => import('../rotate-image')),
  'social-media-image-resizer': dynamic(() => import('../social-media-image-resizer')),
  'split-image': dynamic(() => import('../split-image')),
  'upscale-image': dynamic(() => import('../upscale-image')),
});
