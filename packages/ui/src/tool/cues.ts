import type { Cue, Issue } from '@etb/core/subtitles';

/**
 * The subtitle editor's playhead time, in seconds, kept out of the editor's
 * state: it changes at every frame while the media plays, and only what
 * follows it (the playhead, the readout, the cue over the video) renders
 * then, not the list of cues.
 */
export interface Clock {
  get: () => number;
  set: (seconds: number) => void;
  /** Calls `listener` at every change; returns the way to stop. */
  subscribe: (listener: () => void) => () => void;
}

export function createClock(): Clock {
  let time = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => time,
    set(seconds) {
      if (seconds === time) return;
      time = seconds;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The cue on screen at `ms`: the first that has started and not ended, or -1. */
export function cueAt(cues: readonly Cue[], ms: number): number {
  return cues.findIndex((cue) => cue.start <= ms && ms < cue.end);
}

/**
 * Whether two lists of issues say the same. Every check makes new ones, so a
 * row compares what they say, and renders again only when that changed.
 */
export function sameIssues(a: readonly Issue[], b: readonly Issue[]): boolean {
  return (
    a === b ||
    (a.length === b.length &&
      a.every((issue, i) => {
        const other = b[i];
        return (
          issue.index === other?.index && issue.kind === other.kind && issue.detail === other.detail
        );
      }))
  );
}

/**
 * Whether a memoised row can stay as it is: every prop the same, where the
 * issues compare by what they say.
 */
export function sameRow<P extends { issues: readonly Issue[] }>(a: P, b: P): boolean {
  return (
    sameIssues(a.issues, b.issues) &&
    Object.keys(a).length === Object.keys(b).length &&
    (Object.keys(a) as (keyof P)[]).every((key) => key === 'issues' || a[key] === b[key])
  );
}

/**
 * Whether the cues come back from JSON as they went in. JSON has no Infinity
 * or NaN: a cue with such a time is not a cue when it's read back.
 */
export function keptByJson(cues: readonly Cue[]): boolean {
  return cues.every((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end));
}
