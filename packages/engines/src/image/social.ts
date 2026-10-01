/**
 * `image-geometry` for P13 Social Media Image Resizer (tools/photo.md): one
 * image made to a platform's exact size. Fill crops the largest window of
 * the size's shape around a focal point; Fit keeps the whole image and fills
 * the rest with a blurred copy of it or one colour. Pure functions on RGBA
 * pixels, for the image worker and unit tests.
 */
import { centredRatio, cropPixels, resample, type Pixels, type Rect, type Size } from './geometry';

export type SocialFit = 'fill' | 'blur' | 'color';

/** Where the subject is, as a share of the width and height (0-1). */
export interface Focus {
  x: number;
  y: number;
}

export const CENTRE: Focus = { x: 0.5, y: 0.5 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** "0.3,0.7" → { x: 0.3, y: 0.7 }; anything else is the centre. */
export function focusOf(value: string | undefined): Focus {
  const [x, y] = (value ?? '').split(',').map(Number);
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y))
    return CENTRE;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

/**
 * The largest window of the target's shape inside the source, centred on the
 * focus as far as the edges allow.
 */
export function focusCrop(source: Size, target: Size, focus: Focus): Rect {
  const { width, height } = centredRatio(source, target.width / target.height);
  return {
    x: Math.round(clamp(focus.x * source.width - width / 2, 0, source.width - width)),
    y: Math.round(clamp(focus.y * source.height - height / 2, 0, source.height - height)),
    width,
    height,
  };
}

/** The whole source scaled to fit inside the target, and where it sits (centred). */
export function fitPlacement(source: Size, target: Size): Rect {
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const width = clamp(Math.round(source.width * scale), 1, target.width);
  const height = clamp(Math.round(source.height * scale), 1, target.height);
  return {
    x: Math.floor((target.width - width) / 2),
    y: Math.floor((target.height - height) / 2),
    width,
    height,
  };
}

/** How much the source is enlarged to make the target: above 1 it may look soft. */
export function enlargement(source: Size, target: Size, fit: SocialFit): number {
  if (fit === 'fill') {
    const crop = centredRatio(source, target.width / target.height);
    return target.width / crop.width;
  }
  return Math.min(target.width / source.width, target.height / source.height);
}

/** One pass of a box blur along rows (`horizontal`) or columns, edges repeated. */
function boxPass(image: Pixels, radius: number, horizontal: boolean): Pixels {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const stride = horizontal ? 4 : width * 4;
  const size = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const base = horizontal ? line * width * 4 : line * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      const at = (i: number) => data[base + clamp(i, 0, length - 1) * stride + channel] ?? 0;
      let sum = 0;
      for (let i = -radius; i <= radius; i += 1) sum += at(i);
      for (let i = 0; i < length; i += 1) {
        out[base + i * stride + channel] = sum / size;
        sum += at(i + radius + 1) - at(i - radius);
      }
    }
  }
  return { data: out, width, height };
}

/** Three box blurs each way: close to a Gaussian, in time that doesn't grow with the radius. */
export function boxBlur(image: Pixels, radius: number): Pixels {
  if (radius < 1) return image;
  let out = image;
  for (let pass = 0; pass < 3; pass += 1) {
    out = boxPass(boxPass(out, radius, true), radius, false);
  }
  return out;
}

/**
 * The background for Fit with blur: the image filling the target, blurred.
 * Blurred small (a sixteenth of the size) and scaled up, so a 2560 px banner
 * takes a fraction of a second.
 */
export function blurredBackdrop(image: Pixels, target: Size): Pixels {
  const cover = cropPixels(image, focusCrop(image, target, CENTRE));
  const small = {
    width: Math.max(4, Math.round(target.width / 16)),
    height: Math.max(4, Math.round(target.height / 16)),
  };
  const shrunk = resample(cover, small.width, small.height, 'bilinear');
  const blurred = boxBlur(
    shrunk,
    Math.max(1, Math.round(Math.min(small.width, small.height) / 20)),
  );
  return resample(blurred, target.width, target.height, 'bilinear');
}

/** A canvas of one colour; RGBA. */
export function solid(size: Size, rgba: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(size.width * size.height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { data, width: size.width, height: size.height };
}

/** Draws `top` over `base` at a position, blending by `top`'s alpha. */
export function composite(base: Pixels, top: Pixels, at: { x: number; y: number }): Pixels {
  const out = new Uint8ClampedArray(base.data);
  for (let y = 0; y < top.height; y += 1) {
    const by = at.y + y;
    if (by < 0 || by >= base.height) continue;
    for (let x = 0; x < top.width; x += 1) {
      const bx = at.x + x;
      if (bx < 0 || bx >= base.width) continue;
      const t = (y * top.width + x) * 4;
      const b = (by * base.width + bx) * 4;
      const alpha = (top.data[t + 3] ?? 0) / 255;
      if (alpha === 1) {
        out.set(top.data.subarray(t, t + 4), b);
        continue;
      }
      const under = (out[b + 3] ?? 0) / 255;
      const outAlpha = alpha + under * (1 - alpha);
      for (let c = 0; c < 3; c += 1) {
        const value =
          outAlpha === 0
            ? 0
            : ((top.data[t + c] ?? 0) * alpha + (out[b + c] ?? 0) * under * (1 - alpha)) / outAlpha;
        out[b + c] = value;
      }
      out[b + 3] = outAlpha * 255;
    }
  }
  return { data: out, width: base.width, height: base.height };
}

export interface FrameSpec {
  fit: SocialFit;
  focus: Focus;
  /** Fit with colour: the fill, RGBA. */
  color: [number, number, number, number];
}

/** The image made to exactly `target`: filled around the focus, or fitted on blur or a colour. */
export function socialFrame(image: Pixels, target: Size, spec: FrameSpec): Pixels {
  if (spec.fit === 'fill') {
    const crop = cropPixels(image, focusCrop(image, target, spec.focus));
    return resample(crop, target.width, target.height, 'lanczos');
  }
  const place = fitPlacement(image, target);
  const scaled = resample(image, place.width, place.height, 'lanczos');
  const base = spec.fit === 'blur' ? blurredBackdrop(image, target) : solid(target, spec.color);
  return composite(base, scaled, place);
}

/** "#336699" → [51, 102, 153, 255]; anything else is white. */
export function rgbaOf(hex: string | undefined): [number, number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!match?.[1]) return [255, 255, 255, 255];
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}
