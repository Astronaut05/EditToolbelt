import type { Engine } from './types';

/** What a page asks an engine before its code has loaded. */
export type EngineMeta<Opts> = Pick<Engine<Opts>, 'capabilities' | 'estimate'>;

/**
 * An engine whose code loads on its first run (docs/10 → the engine is not in
 * the initial bundle). `capabilities` and `estimate` answer at once, from the page.
 *
 * ./lazy-engines holds one file per engine that @etb/engines exports this
 * way: its `*_META`, which the engine itself spreads in so both answer the
 * same, and the lazy engine; async helpers a page calls when a file arrives
 * (`imageHeader`, `renamePlan`, `readSubtitleFile`) load the same way. One file
 * each, so a page carries only its own. The engines' code stays where it was;
 * tests import it from there.
 */
export function lazyEngine<Opts>(
  load: () => Promise<Engine<Opts>>,
  meta: EngineMeta<Opts>,
): Engine<Opts> {
  let loaded: Promise<Engine<Opts>> | null = null;
  return {
    ...meta,
    async run(input, opts, ctx) {
      loaded ??= load();
      return (await loaded).run(input, opts, ctx);
    },
  };
}
