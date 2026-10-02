/**
 * The Wave 3 GPU tools' limits that depend on the file, not just its size or
 * length (tools/video.md → V20, V21; tools/photo.md → P17). Pure, so the
 * pages show them before anything is sent and the jobs API refuses past them
 * before anything is charged (server/job-rules.ts). The worker and the GPU
 * functions hold the same numbers (apps/worker/tests/test_gpu_consistency.py).
 */

/**
 * The video GPU tools take this many frames at most: 10 minutes at 30 fps
 * (V20's 10 min cap), so 5 at 60. The GPU's work goes by frames.
 */
export const MAX_VIDEO_FRAMES = 18_000;
/** The largest picture they make or take: 4K UHD, either way round (V20: "max 4K output"). */
export const MAX_LONG_SIDE = 3840;
export const MAX_SHORT_SIDE = 2160;
/** ProRes 4444 with alpha, bits a pixel: Apple's 330 Mbps at 1080p30, plus about 20 % for alpha. */
export const PRORES_BITS_PER_PIXEL = 6.5;
/** The most V21 writes as ProRes: one upload holds 4.9 GB; this leaves room to spare. */
export const MAX_PRORES_BYTES = 4_500_000_000;

export function fits4k(width: number, height: number): boolean {
  return Math.max(width, height) <= MAX_LONG_SIDE && Math.min(width, height) <= MAX_SHORT_SIDE;
}

/** The frame rate the GPU reads a clip at: its own (120 at most), or 30 when it doesn't say. */
export function workingFps(fps: number | null | undefined): number {
  return Math.min(fps ?? 30, 120) || 30;
}

/** Frames the GPU will see in a clip of this length. */
export function framesOf(durationSec: number, fps: number | null | undefined): number {
  return Math.round(durationSec * workingFps(fps));
}

/** About how big a ProRes 4444 clip with alpha is, in bytes. */
export function proresBytesOf(width: number, height: number, frames: number): number {
  return (width * height * frames * PRORES_BITS_PER_PIXEL) / 8;
}

/** 29.97, 30, 59.94: a rate as people write it. */
export function fpsLabel(fps: number): string {
  return fps.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Object Eraser's mask has the image's shape: its size, or scaled (a big
 * image's mask is drawn smaller). Half a pixel of rounding each way is
 * allowed, and 1 % more (apps/worker/src/etb_worker/gpu/inpaint.py → mask_fits).
 */
export function maskFits(maskW: number, maskH: number, width: number, height: number): boolean {
  if (Math.min(maskW, maskH, width, height) <= 0) return false;
  return Math.abs(maskW * height - maskH * width) <= (width + height) / 2 + 0.01 * maskW * height;
}
