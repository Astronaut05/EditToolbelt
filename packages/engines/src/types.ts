/**
 * The engine contract every processing engine implements (docs/02 → Engines).
 * The engines themselves arrive in M2; M1 only needs the contract and a dummy
 * so the ToolShell can be built and tested against it.
 */

export interface Capabilities {
  webgpu: boolean;
  webcodecs: boolean;
  sharedArrayBuffer: boolean;
  deviceMemoryGb?: number;
  hardwareConcurrency: number;
}

export interface InputMeta {
  name: string;
  type: string;
  size: number;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface RunContext {
  /** 0-1, with an optional stage label ("Downloading the AI model, first time only"). */
  progress(fraction: number, stage?: string): void;
  signal: AbortSignal;
}

export interface EngineOutput {
  blob: Blob;
  /** Output file extension without the dot, e.g. "png". */
  ext: string;
  width?: number;
  height?: number;
  durationSec?: number;
  /** Which path ran, shown in the result readout: "WebGPU", "WASM", "Server". */
  path: string;
  /** What changed or was dropped, in plain words: "12 style overrides removed". */
  notes?: string[];
  /** Extra facts for the result readout: { label: 'Cues', value: '142' }. */
  details?: { label: string; value: string }[];
}

export interface Engine<Opts = Record<string, unknown>, Out extends EngineOutput = EngineOutput> {
  capabilities(caps: Capabilities): { supported: boolean; reason?: string };
  estimate(input: InputMeta, opts: Opts): { seconds: number; outputBytes?: number };
  run(input: File | Blob, opts: Opts, ctx: RunContext): Promise<Out>;
}
