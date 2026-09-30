import { lazyEngine, type Engine } from '@etb/engines';

type MediaEngines = typeof import('@etb/engines/media-engines');

/** The media engines' entry, with Mediabunny behind it: loaded on first use, not with the page (docs/10). */
export const loadMediaEngines = (): Promise<MediaEngines> => import('@etb/engines/media-engines');

/**
 * A media tool's engine. Its code loads on the first run; until then the
 * page answers from `meta` (MEDIA_META in @etb/engines, which the engine
 * itself spreads in, so both answer the same).
 */
export function mediaEngine<Opts>(
  pick: (engines: MediaEngines) => Engine<Opts>,
  meta: Pick<Engine<Opts>, 'capabilities' | 'estimate'>,
): Engine<Opts> {
  return lazyEngine(() => loadMediaEngines().then(pick), meta);
}
