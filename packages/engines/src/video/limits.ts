/**
 * Video limits, apart from the engine so pages can show them without loading
 * Mediabunny (docs/10 → the engine is not in the initial bundle).
 */

/** tools/video.md → Limits (browser). */
export const VIDEO_LIMITS = {
  maxBytes: 2 * 1024 ** 3,
  maxSeconds: 60 * 60,
  /** Shown as advice on phones, not enforced. */
  phoneBytes: 500 * 1024 ** 2,
  phoneSeconds: 10 * 60,
};
