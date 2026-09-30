import type { Engine } from './types';

/**
 * An engine whose code loads on its first run (docs/10 → the engine is not in
 * the initial bundle). `capabilities` and `estimate` answer at once, from the page.
 */
export function lazyEngine<Opts>(
  load: () => Promise<Engine<Opts>>,
  meta: Pick<Engine<Opts>, 'capabilities' | 'estimate'>,
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
