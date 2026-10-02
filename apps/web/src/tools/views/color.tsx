'use client';

import dynamic from 'next/dynamic';

import type { ViewIds } from '../ids';
import { viewIndex } from './view-index';

/** The color tools' views, by id (`VIEW_IDS.color` in ../ids.ts). */
export default viewIndex<ViewIds<'color'>>({
  'color-converter': dynamic(() => import('../color-converter')),
  'color-palette-from-image': dynamic(() => import('../color-palette-from-image')),
  'color-picker-from-image': dynamic(() => import('../color-picker-from-image')),
  'contrast-checker': dynamic(() => import('../contrast-checker')),
  'gradient-generator': dynamic(() => import('../gradient-generator')),
  'lut-converter': dynamic(() => import('../lut-converter')),
  'lut-preview': dynamic(() => import('../lut-preview')),
});
