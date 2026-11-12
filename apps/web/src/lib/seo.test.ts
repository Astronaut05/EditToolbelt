import { getTool } from '@etb/registry';
import { describe, expect, it } from 'vitest';

import { isFree } from './seo';

// The structured data says a page is free (isAccessibleForFree, a zero-price
// Offer) exactly when its visible copy does.
describe('free, as the structured data says it', () => {
  it('is every tool that runs in the browser, server path or not', () => {
    for (const id of ['timecode-calculator', 'image-converter', 'trim-video']) {
      expect(isFree(getTool(id)), id).toBe(true);
    }
    // Free in the browser; credits only for the optional server path.
    for (const id of ['remove-background', 'compress-video', 'video-converter', 'merge-videos']) {
      const tool = getTool(id);
      expect(tool.runtime, id).toBe('hybrid');
      expect(isFree(tool), id).toBe(true);
    }
  });

  it('is not a tool that runs only on our servers for credits', () => {
    for (const id of ['upscale-image', 'transcribe-audio']) {
      const tool = getTool(id);
      expect(tool.cost.kind, id).not.toBe('free');
      expect(isFree(tool), id).toBe(false);
    }
  });
});
