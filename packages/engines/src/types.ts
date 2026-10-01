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
  /**
   * 0-1, with an optional stage label ("Downloading the AI model, first time
   * only") and the readout under the bar: amount "74 / 115 MB", step "Step 1 of 2".
   */
  progress(fraction: number, stage?: string, detail?: { amount?: string; step?: string }): void;
  signal: AbortSignal;
}

export interface EngineOutput {
  blob: Blob;
  /** Output file extension without the dot, e.g. "png". */
  ext: string;
  /** The download name's suffix when it depends on the run (P13: "instagram-square-1080x1080"). */
  nameSuffix?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  /** Which path ran, shown in the result readout: "WebGPU", "WASM", "Server". */
  path: string;
  /** What changed or was dropped, in plain words: "12 style overrides removed". */
  notes?: string[];
  /** Extra facts for the result readout: { label: 'Cues', value: '142' }, with a unit if it has one. */
  details?: { label: string; value: string; unit?: string }[];
  /** A plain-text report shown under an analyzer's facts (P15: what the photo carried). */
  report?: string;
  /** A line over time under an analyzer's facts (A06: short-term loudness). */
  graph?: {
    label: string;
    unit: string;
    /** When the first value is, and the time between values, seconds. */
    startSec: number;
    stepSec: number;
    values: number[];
    /** Horizontal lines: the integrated loudness. */
    marks: { label: string; value: number }[];
    durationSec: number;
  };
  /** Colours found (C01), most common first, in HEX, RGB and HSL, with their share of the image (0-1). */
  swatches?: { hex: string; rgb: string; hsl: string; share: number }[];
}

export interface Engine<Opts = Record<string, unknown>, Out extends EngineOutput = EngineOutput> {
  capabilities(caps: Capabilities): { supported: boolean; reason?: string };
  estimate(input: InputMeta, opts: Opts): { seconds: number; outputBytes?: number };
  run(input: File | Blob, opts: Opts, ctx: RunContext): Promise<Out>;
}
