/**
 * Whether this browser can decode and encode images the way the image worker
 * does. The image engines' light side (../lazy-engines) answers with it
 * before their code has loaded.
 */
import type { Engine } from '../types';

export const codecCapabilities: Engine['capabilities'] = () => ({
  supported: typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function',
  reason:
    'This browser is too old for in-browser image processing. Try a current Chrome, Firefox or Safari.',
});
