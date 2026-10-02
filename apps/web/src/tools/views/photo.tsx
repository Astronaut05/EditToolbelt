'use client';

import dynamic from 'next/dynamic';

import type { ViewIds } from '../ids';
import { viewIndex } from './view-index';

/** The photo tools' views, by id (`VIEW_IDS.photo` in ../ids.ts). */
export default viewIndex<ViewIds<'photo'>>({
  'add-text-to-image': dynamic(() => import('../add-text-to-image')),
  'blur-image': dynamic(() => import('../blur-image')),
  'compress-image': dynamic(() => import('../compress-image')),
  'crop-image': dynamic(() => import('../crop-image')),
  'draw-on-image': dynamic(() => import('../draw-on-image')),
  'exif-remover': dynamic(() => import('../exif-remover')),
  'image-converter': dynamic(() => import('../image-converter')),
  'object-eraser': dynamic(() => import('../object-eraser')),
  'photo-editor': dynamic(() => import('../photo-editor')),
  'remove-background': dynamic(() => import('../remove-background')),
  'resize-image': dynamic(() => import('../resize-image')),
  'rotate-image': dynamic(() => import('../rotate-image')),
  'social-media-image-resizer': dynamic(() => import('../social-media-image-resizer')),
  'split-image': dynamic(() => import('../split-image')),
  'upscale-image': dynamic(() => import('../upscale-image')),
  'watermark-image': dynamic(() => import('../watermark-image')),
});
