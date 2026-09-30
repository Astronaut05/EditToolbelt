/**
 * Single-threaded entry points for the jSquash AVIF encoder and OxiPNG.
 * Their packaged `encode`/`optimise` pick a multi-threaded build when the
 * browser allows it, and those builds spawn workers that import themselves,
 * which the bundler can't resolve (the build hangs). Threads need
 * SharedArrayBuffer, which needs a cross-origin isolated route, and no image
 * route is one, so the single-threaded builds are all we'd ever run anyway.
 */
import avifFactory from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions as avifDefaults } from '@jsquash/avif/meta.js';
import initOxipng, { optimise } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';

/** The part of the Emscripten module we use (its own types need a global namespace we don't load). */
interface AvifModule {
  encode(
    data: Uint8Array,
    width: number,
    height: number,
    options: typeof avifDefaults,
  ): Uint8Array | null;
}

const createAvif = avifFactory as unknown as (options: {
  noInitialRun: boolean;
}) => Promise<AvifModule>;

let avif: Promise<AvifModule> | null = null;

export async function encodeAvif(image: ImageData, quality: number): Promise<ArrayBuffer> {
  avif ??= createAvif({ noInitialRun: true });
  const module = await avif;
  const out = module.encode(new Uint8Array(image.data.buffer), image.width, image.height, {
    ...avifDefaults,
    quality,
    speed: 6,
  });
  if (!out) throw new Error('AVIF encoding failed');
  return out.slice().buffer;
}

let oxipng: ReturnType<typeof initOxipng> | null = null;

/** Lossless PNG optimisation, level 2 (OxiPNG's default), alpha optimised. */
export async function optimisePng(png: ArrayBuffer): Promise<ArrayBuffer> {
  oxipng ??= initOxipng();
  await oxipng;
  return optimise(new Uint8Array(png), 2, false, true).slice().buffer;
}
