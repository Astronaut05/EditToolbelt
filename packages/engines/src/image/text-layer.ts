/**
 * P10 Add Text to Image (tools/photo.md): text layers as data, in the image's
 * own pixels, and one function that lays them out and draws them. The editor
 * draws them on screen at its zoom, and the export draws them at full size
 * with the same code and the same fonts, so the text lands where it was shown.
 */
import type { Upright } from './upright';
import {
  fontFile,
  TEXT_FONT_PATH,
  TEXT_FONTS,
  TEXT_SUBSETS,
  TEXT_WEIGHTS,
  textFamily,
} from './text-fonts';

export type TextAlign = 'left' | 'center' | 'right';

export interface TextLayer {
  id: string;
  /** Lines split at "\n". */
  text: string;
  /** A TEXT_FONTS id, or "user:<family>" for a font file the user loaded. */
  font: string;
  bold: boolean;
  /** Font size in image pixels. */
  size: number;
  /** "#rrggbb". */
  color: string;
  align: TextAlign;
  /** The block's centre, in image pixels. */
  x: number;
  y: number;
  /** Degrees, clockwise, about the centre. */
  rotation: number;
  /** Outline width in image pixels; 0 for none. */
  stroke: number;
  strokeColor: string;
  /** A soft drop shadow, scaled with the size. */
  shadow: boolean;
  /** A box behind the text. */
  box: boolean;
  boxColor: string;
  /** 0-1. */
  boxOpacity: number;
  /** P01: the turn and mirror that keep it upright in a turned or flipped photo, under `rotation`. */
  base?: Upright;
}

/** Line height, as a multiple of the size. */
export const LINE_HEIGHT = 1.25;
/** The box's padding, as a multiple of the size. */
export const BOX_PADDING = 0.3;

/** The measuring and drawing calls a layer needs (a canvas 2D context, on screen or offscreen). */
export type TextPen = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'fillRect'
  | 'fillText'
  | 'strokeText'
  | 'measureText'
> & {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
};

export function fontFamily(font: string): string {
  const family = font.startsWith('user:') ? font.slice(5) : textFamily(font);
  return `"${family}", "${textFamily('onest')}", sans-serif`;
}

/** The CSS font for a layer at a size. */
export const cssFont = (layer: Pick<TextLayer, 'font' | 'bold'>, px: number) =>
  `${layer.bold ? '700' : '400'} ${String(px)}px ${fontFamily(layer.font)}`;

export interface TextBlock {
  /** The text's own width and height, without the box's padding. */
  width: number;
  height: number;
  lines: { text: string; width: number }[];
}

/** Measures a layer's lines at its own size, in image pixels. */
export function measureText(
  pen: Pick<TextPen, 'font' | 'measureText'>,
  layer: TextLayer,
): TextBlock {
  pen.font = cssFont(layer, layer.size);
  const lines = layer.text
    .split('\n')
    .map((text) => ({ text, width: pen.measureText(text).width }));
  return {
    width: Math.max(0, ...lines.map((line) => line.width)),
    height: lines.length * layer.size * LINE_HEIGHT,
    lines,
  };
}

/** The layer's outline before rotation, centred on (0, 0): the text, plus the box's padding when it has one. */
export function layerFrame(block: TextBlock, layer: TextLayer): { width: number; height: number } {
  const pad = layer.box ? layer.size * BOX_PADDING * 2 : 0;
  return { width: block.width + pad, height: block.height + pad };
}

/** Draws one layer. `scale` takes image pixels to the canvas's pixels. */
export function drawTextLayer(pen: TextPen, layer: TextLayer, scale = 1): void {
  if (!layer.text.trim()) return;
  const block = measureText(pen, layer);
  pen.save();
  pen.scale(scale, scale);
  pen.translate(layer.x, layer.y);
  if (layer.base) {
    pen.rotate((layer.base.rotation * Math.PI) / 180);
    if (layer.base.mirror) pen.scale(-1, 1);
  }
  pen.rotate((layer.rotation * Math.PI) / 180);
  if (layer.box) {
    const frame = layerFrame(block, layer);
    pen.globalAlpha = Math.min(1, Math.max(0, layer.boxOpacity));
    pen.fillStyle = layer.boxColor;
    pen.fillRect(-frame.width / 2, -frame.height / 2, frame.width, frame.height);
    pen.globalAlpha = 1;
  }
  pen.font = cssFont(layer, layer.size);
  pen.textAlign = layer.align;
  pen.textBaseline = 'middle';
  const x =
    layer.align === 'left' ? -block.width / 2 : layer.align === 'right' ? block.width / 2 : 0;
  const lineHeight = layer.size * LINE_HEIGHT;
  // A shadow's blur and offset aren't scaled or turned by the transform, so they are by hand:
  // straight down in the saved image, so turned with the layer's base in the photo's own pixels.
  const drop = layer.size * 0.06 * scale;
  const turn = ((layer.base?.rotation ?? 0) * Math.PI) / 180;
  const shadow = () => {
    pen.shadowColor = 'rgba(0, 0, 0, 0.5)';
    pen.shadowBlur = layer.size * 0.15 * scale;
    pen.shadowOffsetX = -Math.sin(turn) * drop;
    pen.shadowOffsetY = Math.cos(turn) * drop;
  };
  const plain = () => {
    pen.shadowColor = 'transparent';
    pen.shadowBlur = 0;
    pen.shadowOffsetY = 0;
  };
  block.lines.forEach((line, i) => {
    const y = -block.height / 2 + (i + 0.5) * lineHeight;
    if (layer.stroke > 0) {
      // The outline is drawn first and twice as wide, so the fill covers its inner half.
      if (layer.shadow) shadow();
      pen.lineJoin = 'round';
      pen.lineWidth = layer.stroke * 2;
      pen.strokeStyle = layer.strokeColor;
      pen.strokeText(line.text, x, y);
      plain();
    } else if (layer.shadow) {
      shadow();
    }
    pen.fillStyle = layer.color;
    pen.fillText(line.text, x, y);
    plain();
  });
  pen.restore();
}

export function drawTextLayers(pen: TextPen, layers: readonly TextLayer[], scale = 1): void {
  for (const layer of layers) drawTextLayer(pen, layer, scale);
}

/** Whether a point (image pixels) is on a layer, its rotation undone. */
export function hitsLayer(block: TextBlock, layer: TextLayer, px: number, py: number): boolean {
  const angle = (-layer.rotation * Math.PI) / 180;
  let dx = px - layer.x;
  let dy = py - layer.y;
  if (layer.base) {
    const back = (-layer.base.rotation * Math.PI) / 180;
    [dx, dy] = [
      dx * Math.cos(back) - dy * Math.sin(back),
      dx * Math.sin(back) + dy * Math.cos(back),
    ];
    if (layer.base.mirror) dx = -dx;
  }
  const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
  const frame = layerFrame(block, layer);
  const slack = layer.size * 0.2;
  return Math.abs(lx) <= frame.width / 2 + slack && Math.abs(ly) <= frame.height / 2 + slack;
}

/** A centre that snaps to the image's middle lines when it's within `reach` (image pixels). */
export function snapCentre(
  x: number,
  y: number,
  width: number,
  height: number,
  reach: number,
): { x: number; y: number; snappedX: boolean; snappedY: boolean } {
  const snappedX = Math.abs(x - width / 2) <= reach;
  const snappedY = Math.abs(y - height / 2) <= reach;
  return {
    x: snappedX ? width / 2 : x,
    y: snappedY ? height / 2 : y,
    snappedX,
    snappedY,
  };
}

const registered = new Set<string>();

/**
 * Makes a bundled font usable on this page: its subsets registered with their
 * unicode ranges, and the ones `text` needs loaded. User fonts are already
 * registered when they're picked.
 */
export async function loadTextFont(
  layer: Pick<TextLayer, 'font' | 'bold' | 'text'>,
): Promise<void> {
  if (typeof document === 'undefined') return;
  const font = TEXT_FONTS.find((candidate) => candidate.id === layer.font);
  if (font) {
    for (const weight of TEXT_WEIGHTS) {
      const key = `${font.id}:${String(weight)}`;
      if (registered.has(key)) continue;
      registered.add(key);
      for (const [subset, range] of TEXT_SUBSETS) {
        document.fonts.add(
          new FontFace(
            textFamily(font.id),
            `url(${TEXT_FONT_PATH}${fontFile(font, subset, weight)}) format("woff2")`,
            { weight: font.variable ? '100 900' : String(weight), unicodeRange: range },
          ),
        );
      }
      if (font.variable) break;
    }
  }
  try {
    await document.fonts.load(cssFont(layer, 40), layer.text || 'A');
  } catch {
    // A font that fails to load falls back to the next in the stack.
  }
}

/** A font file the user picked, registered under its own family; it stays on the device. */
export async function addUserFont(file: File): Promise<string> {
  const family = `etb-user-${file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9-]+/g, '-')}`;
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  return `user:${family}`;
}

/**
 * The layers drawn on a transparent canvas the image's size, at full
 * resolution, ready to lay over it. Fonts load first, so the export uses the
 * same faces the preview showed.
 */
export async function renderTextOverlay(
  layers: readonly TextLayer[],
  width: number,
  height: number,
): Promise<ImageBitmap> {
  await Promise.all(layers.map((layer) => loadTextFont(layer)));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in this browser');
  drawTextLayers(ctx, layers, 1);
  return canvas.transferToImageBitmap();
}
