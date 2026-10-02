import type { Point, Size, Upright } from '@etb/engines';

/** A pointer's place on screen → the image's own pixels (before turns, flips and the angle). */
export type ToImage = (clientX: number, clientY: number) => Point;

/** A screen nudge (arrow keys) → the same move in the image's own pixels. */
export type Nudge = (dx: number, dy: number) => [number, number];

/** The mapping for a layer that isn't turned: its own box on screen is the image. */
export function boxMapping(element: Element | null, natural: Size): ToImage {
  const rect = element?.getBoundingClientRect();
  return (clientX, clientY) =>
    rect && rect.width > 0
      ? [
          ((clientX - rect.left) / rect.width) * natural.width,
          ((clientY - rect.top) / rect.height) * natural.height,
        ]
      : [0, 0];
}

/** Image pixels per screen pixel, under a mapping. */
export function imagePerScreen(toImage: ToImage): number {
  const [x0, y0] = toImage(0, 0);
  const [x1, y1] = toImage(1, 0);
  return Math.hypot(x1 - x0, y1 - y0) || 1;
}

/** An upright worth keeping on a new layer or marker: none when the photo isn't turned or flipped. */
export const baseOf = (upright: Upright | undefined): Upright | undefined =>
  upright && (upright.rotation !== 0 || upright.mirror) ? upright : undefined;
