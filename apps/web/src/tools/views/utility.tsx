'use client';

import dynamic from 'next/dynamic';

import type { ViewIds } from '../ids';
import { viewIndex } from './view-index';

/** The utility tools' views, by id (`VIEW_IDS.utility` in ../ids.ts). */
export default viewIndex<ViewIds<'utility'>>({
  'dpi-calculator': dynamic(() => import('../dpi-calculator')),
  'qr-code-generator': dynamic(() => import('../qr-code-generator')),
});
