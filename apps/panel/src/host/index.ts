import { browserHost } from './browser';
import { premiereHost } from './premiere';
import type { Host } from './types';

export type { Host, PickedFile } from './types';

/** Premiere when the panel runs in it, a browser otherwise. */
export function detectHost(): Host {
  return premiereHost() ?? browserHost();
}
