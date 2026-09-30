/**
 * The small part of P07 the page needs before a run (can quality mode run
 * here, is a model already downloaded), apart from the engine itself, which
 * the page loads only when a photo arrives (docs/10 → the engine is not in
 * the initial bundle).
 */
import { ORT_BUILDS, ORT_VERSION, SEGMENT_MODELS, type SegmentModel } from './models';

/** Cache Storage name shared with the service worker (apps/web/scripts/sw.ts). */
const MODELS_CACHE = 'etb-models';

/** `base` without trailing slashes, then `/file`. A loop, not a regex: the base comes from config. */
function join(base: string, file: string): string {
  let end = base.length;
  while (end > 0 && base[end - 1] === '/') end -= 1;
  return `${base.slice(0, end)}/${file}`;
}

let f16: Promise<boolean> | null = null;

/** Whether quality mode can run here: WebGPU with 16-bit float shaders. */
export function canRunQuality(): Promise<boolean> {
  f16 ??= (async () => {
    // Typed as always there, but missing in Firefox and Safari without WebGPU.
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    try {
      const adapter = (await gpu.requestAdapter()) as { features: Set<string> } | null;
      return adapter?.features.has('shader-f16') ?? false;
    } catch {
      return false;
    }
  })();
  return f16;
}

/** The model a run will use: quality where it runs, unless light mode is asked for. */
export async function pickModel(preference: string | undefined): Promise<SegmentModel> {
  if (preference !== 'light' && (await canRunQuality())) return SEGMENT_MODELS['birefnet-lite'];
  return SEGMENT_MODELS.u2netp;
}

/** The files a model needs: itself and the ONNX Runtime build for its backend. */
export function filesFor(model: SegmentModel, base: string) {
  const build = model.needs === 'webgpu-f16' ? ORT_BUILDS.webgpu : ORT_BUILDS.wasm;
  const ortBase = join(base, `ort/${ORT_VERSION}`);
  const wasm = build.files.find((file) => file.endsWith('.wasm')) ?? '';
  return {
    provider: model.needs === 'webgpu-f16' ? ('webgpu' as const) : ('wasm' as const),
    modelUrl: join(base, model.file),
    ortUrl: join(ortBase, build.module),
    wasmPaths: `${ortBase}/`,
    wasmUrl: join(ortBase, wasm),
    bytes: model.bytes + build.bytes,
    runtimeBytes: build.bytes,
  };
}

export async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(MODELS_CACHE);
  } catch {
    return null; // Not a secure context, or storage is blocked.
  }
}

/** Whether a model and its runtime are already on this device. */
export async function modelCached(model: SegmentModel, base: string): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  const files = filesFor(model, base);
  const hits = await Promise.all([cache.match(files.modelUrl), cache.match(files.wasmUrl)]);
  return hits.every(Boolean);
}
