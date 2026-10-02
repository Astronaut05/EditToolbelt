/**
 * P01: marks and text live in the photo's own pixels and turn with it, so
 * something added after a turn, a flip or a straighten would come out
 * sideways or mirrored. `Upright` is the turn (and mirror) that undoes the
 * editor's frame at the moment it was added, so it reads the right way in
 * the saved image.
 */

export interface Upright {
  /** Degrees, clockwise. */
  rotation: number;
  /** Mirrored left to right, after the rotation. */
  mirror: boolean;
}

/** The editor's frame: quarter turns, then the flips, then the free angle (as the engine applies them). */
export interface Frame {
  turns: number;
  flip: boolean;
  flipV: boolean;
  angle: number;
}

const norm = (degrees: number) => {
  const d = ((degrees % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};

/**
 * The inverse of the frame as a rotation and an optional mirror. The frame
 * is R(angle)·flipV·flipH·R(turns); its inverse is R(−turns)·flipH·flipV·R(−angle),
 * and a flip moves past a rotation by negating it.
 */
export function uprightFor(frame: Frame): Upright {
  const t = frame.turns * 90;
  const a = frame.angle;
  if (frame.flip && frame.flipV) return { rotation: norm(180 - t - a), mirror: false };
  if (frame.flip) return { rotation: norm(a - t), mirror: true };
  if (frame.flipV) return { rotation: norm(180 - t + a), mirror: true };
  return { rotation: norm(-t - a), mirror: false };
}

/** A vector (a nudge on screen) taken into the photo's own pixels by an upright. */
export function throughUpright(dx: number, dy: number, upright: Upright): [number, number] {
  const x = upright.mirror ? -dx : dx;
  const r = (upright.rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(r) * 1e9) / 1e9;
  const sin = Math.round(Math.sin(r) * 1e9) / 1e9;
  return [x * cos - dy * sin, x * sin + dy * cos];
}

/** The frame applied to a point relative to the image's centre (what the screen shows). */
export function throughFrame(dx: number, dy: number, frame: Frame): [number, number] {
  const turn = (x: number, y: number, degrees: number): [number, number] => {
    const r = (degrees * Math.PI) / 180;
    return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
  };
  let [x, y] = turn(dx, dy, frame.turns * 90);
  if (frame.flip) x = -x;
  if (frame.flipV) y = -y;
  [x, y] = turn(x, y, frame.angle);
  return [x, y];
}
