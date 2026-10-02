/**
 * The background-removal models (tools/photo.md → P07, open question 11).
 * Files are served from MODELS_BASE_URL (a local path until Go public, then
 * the R2 `models.` host). `pnpm models` downloads them from the sources in
 * models.json and checks each against its SHA-256 here; the browser checks
 * the hash again before it runs a model.
 */

export interface SegmentModel {
  id: 'birefnet-lite' | 'u2netp';
  /** For the settings: "Quality · 115 MB". */
  label: string;
  /** Path under MODELS_BASE_URL. */
  file: string;
  /** Pinned from a trusted download; `pnpm models` and the browser both check it. */
  sha256: string;
  /** Download size, for the first-use progress. */
  bytes: number;
  /** Square input side in px. */
  size: number;
  mean: [number, number, number];
  std: [number, number, number];
  /** logits need a sigmoid; probability is already 0-1 (min-max stretched, as rembg does). */
  output: 'logits' | 'probability';
  /** Quality mode needs WebGPU with 16-bit floats; light mode runs anywhere (WASM). */
  needs: 'webgpu-f16' | 'wasm';
}

const IMAGENET = {
  mean: [0.485, 0.456, 0.406] as [number, number, number],
  std: [0.229, 0.224, 0.225] as [number, number, number],
};

export const SEGMENT_MODELS: Record<SegmentModel['id'], SegmentModel> = {
  'birefnet-lite': {
    id: 'birefnet-lite',
    label: 'Quality · 115 MB',
    file: 'rmbg/birefnet-lite-fp16.onnx',
    // As CI downloaded it from models.json's source (114.5 MB), 2026-10-02.
    sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402',
    bytes: 115_000_000,
    size: 1024,
    ...IMAGENET,
    output: 'logits',
    needs: 'webgpu-f16',
  },
  u2netp: {
    id: 'u2netp',
    label: 'Light · 4.6 MB',
    file: 'rmbg/u2netp.onnx',
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    bytes: 4_574_861,
    size: 320,
    ...IMAGENET,
    output: 'probability',
    needs: 'wasm',
  },
};

/** ONNX Runtime Web, served next to the models; `pnpm models` checks the installed version matches. */
export const ORT_VERSION = '1.30.0';

/** Its module and WASM files per runtime: the WebGPU build also runs WASM, but is twice the size. */
export const ORT_BUILDS = {
  wasm: {
    module: 'ort.wasm.min.mjs',
    files: ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'],
    bytes: 14_300_000,
  },
  webgpu: {
    module: 'ort.webgpu.min.mjs',
    files: ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'],
    bytes: 26_900_000,
  },
} as const;

export const ORT_FILES = Object.values(ORT_BUILDS).flatMap((build) => [
  build.module,
  ...build.files,
]);
