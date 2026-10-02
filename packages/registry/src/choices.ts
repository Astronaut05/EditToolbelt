/**
 * Settings a tool takes the same way in the browser and on our servers, as
 * plain lists: the tool page builds its controls from them, and
 * `@etb/registry/options` builds the server's checks from them, so the two
 * paths can't drift apart. No Zod here: tool pages import this.
 */

/** V12 Merge Videos. */
export const MERGE_VIDEOS = {
  /** Clips in one merge, browser or server. */
  minClips: 2,
  maxClips: 20,
  transitions: ['none', 'crossfade'],
  /** Crossfade seconds. */
  crossfades: ['0.5', '1', '2'],
  /** `first` (the first clip's), or the height. */
  sizes: ['first', '2160', '1080', '720', '480'],
  /** `first` (the first clip's, as the nearest standard rate), or frames a second. */
  fps: ['first', '24', '25', '30', '50', '60'],
} as const;
