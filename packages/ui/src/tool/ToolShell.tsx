'use client';

import type { Engine } from '@etb/engines';
import { ChevronRight, Download } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '../cn';
import { AppLink } from '../primitives/AppLink';
import { Breadcrumb } from '../primitives/Breadcrumb';
import { Button } from '../primitives/Button';
import { Kbd } from '../primitives/Kbd';
import { NumberedList } from '../primitives/NumberedList';
import { OptionFact, OptionRow, OptionsPanel } from '../primitives/OptionsPanel';
import { ColorInput, NumberWithUnit, Select, Slider } from '../primitives/fields';
import { Dialog } from '../primitives/overlays';
import { PrivacyBadge, type Noun } from '../primitives/PrivacyBadge';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { StatePanel } from '../primitives/states';
import { BatchList, type BatchItem } from './BatchList';
import { BeforeAfter, MediaTag } from './BeforeAfter';
import { CalculatorShell } from './CalculatorShell';
import type { EditorMode } from './CanvasEditor';
import { boxLabel } from './crop';
import { DropZone } from './DropZone';
import { FactGrid, type GridFact } from './FactGrid';
import { durationBucket, formatBytes, outputName, sizeBucket } from './format';
import { ProgressBar } from './ProgressBar';
import type { BrushStroke } from './RefineBrush';
import { Readout, ReadoutRow, type Fact } from './Readout';
import type { TimelineRange } from './Timeline';
import { useEditor, type EditorState } from './useEditor';

// Workspaces only some tools use load when shown, so each tool page carries
// only its own (docs/10 → initial JS on a tool page).
const CanvasEditor = lazy(() =>
  import('./CanvasEditor').then((m) => ({ default: m.CanvasEditor })),
);
const CropFields = lazy(() => import('./CropFields').then((m) => ({ default: m.CropFields })));
const RefineBrush = lazy(() => import('./RefineBrush').then((m) => ({ default: m.RefineBrush })));
const Timeline = lazy(() => import('./Timeline').then((m) => ({ default: m.Timeline })));

/** What the shell needs from the registry entry (serialisable, no Zod). */
export interface ShellTool {
  id: string;
  name: string;
  h1: string;
  tagline: string;
  runtime: 'client' | 'hybrid' | 'server-cpu' | 'server-gpu';
  ui: 'canvas-editor' | 'timeline' | 'form' | 'analyzer' | 'calculator' | 'batch';
  category: { name: string; href: string };
  related: { name: string; href: string }[];
  howTo?: string[];
}

export interface ShellOption {
  id: string;
  label: string;
  /**
   * choice (default): a segmented control. select: a dropdown, for longer
   * lists. slider and number: a value with its unit. color: a swatch, value
   * "#rrggbb". image: a second image to pick (a new background), value an
   * object URL.
   */
  kind?: 'choice' | 'select' | 'slider' | 'number' | 'color' | 'image';
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default: string;
  /** Shown only while another option has one of these values (quality only for lossy formats). */
  when?: { id: string; values: string[] };
  /** Choices come from the file (the preset's probe), and the option shows only when there are two or more. */
  probed?: boolean;
}

/** Whether an option applies with the current values. */
export function optionVisible(option: ShellOption, values: Record<string, string>): boolean {
  return !option.when || option.when.values.includes(values[option.when.id] ?? '');
}

/** The value as the phone settings rows show it: "WebP", "80", "500 KB". */
export function optionSummary(option: ShellOption, value: string): string {
  if (option.kind === 'slider' || option.kind === 'number') {
    return option.unit ? `${value} ${option.unit}` : value;
  }
  if (option.kind === 'color') return value.toUpperCase();
  if (option.kind === 'image') return value ? 'Chosen' : 'None';
  return option.choices?.find((choice) => choice.value === value)?.label ?? value;
}

/** A second image for an option (a new background): a button, then its name. */
function ImagePick({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  return (
    <span className="flex min-w-0 items-center gap-3">
      {value && (
        <span className="max-w-40 truncate text-14 text-text-muted">{name ?? 'Image chosen'}</span>
      )}
      <Button size="sm" onClick={() => input.current?.click()}>
        {value ? 'Change' : 'Choose image'}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          if (value.startsWith('blob:')) URL.revokeObjectURL(value);
          setName(file.name);
          onChange(URL.createObjectURL(file));
        }}
      />
    </span>
  );
}

function OptionControl({
  option,
  value,
  onChange,
}: {
  option: ShellOption;
  value: string;
  onChange: (value: string) => void;
}) {
  if (option.kind === 'slider') {
    return (
      <span className="flex items-center gap-3">
        <Slider
          aria-label={option.label}
          min={option.min}
          max={option.max}
          step={option.step ?? 1}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className="w-36"
        />
        <span className="w-8 text-right font-mono text-14">{value}</span>
      </span>
    );
  }
  if (option.kind === 'number') {
    return (
      <NumberWithUnit
        aria-label={option.label}
        unit={option.unit ?? ''}
        min={option.min}
        max={option.max}
        step={option.step ?? 1}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  }
  if (option.kind === 'color') {
    return <ColorInput label={option.label} value={value} onChange={onChange} />;
  }
  if (option.kind === 'image') {
    return <ImagePick label={option.label} value={value} onChange={onChange} />;
  }
  if (option.kind === 'select') {
    return (
      <Select
        aria-label={option.label}
        className="w-64"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {option.choices?.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <SegmentedControl
      label={option.label}
      options={option.choices ?? []}
      value={value}
      onChange={onChange}
    />
  );
}

/** Tool-specific settings and copy: the "preset" of docs/02. */
export interface ShellPreset {
  noun: Noun;
  accept: string;
  multiple?: boolean;
  maxBytes: number;
  dropTitle: string;
  chooseLabel: string;
  tapLabel: string;
  formats: string;
  formatsShort?: string;
  camera?: boolean;
  sampleUrl?: string;
  sampleName?: string;
  options: ShellOption[];
  /** Phone result: options grouped into tappable rows, e.g. [["background"], ["edges", "format"]]. */
  phoneGroups?: string[][];
  /** Read-only facts in the settings list: the AI model, an estimate from the options and the file. */
  facts?: (
    state: ShellState,
    options: Record<string, string>,
    media: ProbeInfo | null,
    range: TimelineRange,
  ) => { label: string; value: string }[];
  /** Most files taken at once (tools/photo.md → Batch: 50). */
  maxFiles?: number;
  /** Runs as soon as a file arrives (P07), or waits for the primary action. */
  autoRun?: boolean;
  /** Primary action before a run: "Trim video". */
  runLabel?: string;
  /** Output file extension from the options. */
  outputExt: (options: Record<string, string>) => string;
  outputSuffix: string;
  /** Phone result heading: "Background removed". */
  resultTitle: string;
  /** Line under the actions while running (first model download). */
  runningNote?: string;
  /** Title over the progress bar for a stage. */
  progressTitle?: (stage: string | undefined) => string;
  /**
   * Canvas editor presets: the mode it opens in and the modes it shows, or a
   * compare view; `ratio` reads the crop ratio lock from the options.
   */
  editor?: {
    mode?: EditorMode;
    modes?: EditorMode[];
    compare?: boolean;
    ratio?: (options: Record<string, string>) => number | null;
    /** The option that holds Refine brush strokes (JSON): P07's keep/erase brush on the result. */
    refine?: string;
  };
  /** Result view: before/after (default), or the output alone when its shape changes (crop). */
  result?: 'compare' | 'output';
  /** Why the run can't start with these settings, if it can't. */
  blocked?: (options: Record<string, string>, files: number) => string | undefined;
  /** Analyzer results (dummy data in M1). */
  analyze?: (input: InputInfo) => GridFact[];
  /** Show the start of a text output (subtitles) instead of a file card. */
  preview?: 'text';
  /** Reads a file as it arrives (video: length, frame rate) for the timeline and the settings. */
  probe?: (file: File) => Promise<ProbeInfo>;
  /** The first selection on the timeline, from the clip's length (GIF: the first 5 s). */
  initialRange?: (durationSec: number) => TimelineRange;
}

/** What a preset's probe found. */
export interface ProbeInfo {
  durationSec: number;
  fps?: number;
  /** Picture size as displayed, when there is a picture. */
  width?: number;
  height?: number;
  /** One line about the file: "1920 × 1080 px · 30 fps · H.264 + AAC". */
  summary?: string;
  /** Worth knowing before starting: variable frame rate, HDR. */
  warnings?: string[];
  /** Frames across the clip for the timeline strip (object URLs). */
  thumbnails?: (count: number) => Promise<string[]>;
  /** Choices for `probed` options, by option id (audio tracks). */
  choices?: Record<string, { value: string; label: string }[]>;
}

export interface InputInfo {
  name: string;
  size: number;
  /** Object URL or sample path for the preview. */
  url?: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface OutputInfo {
  size: number;
  ext: string;
  url?: string;
  blob?: Blob;
  seconds: number;
  path: string;
  width?: number;
  height?: number;
  /** What the engine changed or dropped, in plain words. */
  notes?: string[];
  /** Extra readout facts from the engine (cue count, source format). */
  details?: { label: string; value: string }[];
  /** The start of a text output, for `preview: 'text'`. */
  text?: string;
}

/** Characters of a text output shown in the preview. */
const TEXT_PREVIEW_CHARS = 6000;

export type ShellState =
  | { kind: 'empty' }
  | { kind: 'ready'; input: InputInfo; files?: File[] }
  | {
      kind: 'running';
      input: InputInfo;
      fraction?: number;
      stage?: string;
      amount?: string;
      step?: string;
      elapsedSec: number;
    }
  | { kind: 'result'; input: InputInfo; output: OutputInfo; file?: File }
  | { kind: 'error'; label: string; title: string; body: string };

export interface ToolShellProps {
  tool: ShellTool;
  preset: ShellPreset;
  engine: Engine;
  /** Engine options passed through (the dummy engine's duration and stages). */
  engineOptions?: Record<string, unknown>;
  /** Start in a given state: design screens and tests. */
  initialState?: ShellState;
  initialOptions?: Record<string, string>;
  /** Analytics events from docs/09 (bucketed, no file names or contents). */
  onEvent?: (name: string, props: Record<string, string>) => void;
  /** Calculator tools: their own inputs and live results, in the shared layout. */
  calculator?: { inputs: ReactNode; results: ReactNode };
}

/** Refine strokes from their option (JSON), or none if it's empty or malformed. */
function readStrokes(value: string | undefined): BrushStroke[] {
  if (!value) return [];
  try {
    const data: unknown = JSON.parse(value);
    return Array.isArray(data) ? (data as BrushStroke[]) : [];
  } catch {
    return [];
  }
}

function defaults(options: ShellOption[]): Record<string, string> {
  return Object.fromEntries(options.map((option) => [option.id, option.default]));
}

function isImage(preset: ShellPreset) {
  return preset.noun === 'image';
}

/**
 * Renders every tool page from its registry entry and preset (docs/02 → The
 * ToolShell): header block, settings, actions and the workspace for the tool's
 * `ui` type. Owns the shared behaviour: intake, validation, progress, cancel
 * (Esc), download (Ctrl/Cmd+S), start over, errors and the handoff links.
 */
export function ToolShell({
  tool,
  preset,
  engine,
  engineOptions,
  initialState,
  initialOptions,
  onEvent,
  calculator,
}: ToolShellProps) {
  const [state, setState] = useState<ShellState>(initialState ?? { kind: 'empty' });
  const [options, setOptions] = useState<Record<string, string>>(
    initialOptions ?? defaults(preset.options),
  );
  const [range, setRange] = useState<TimelineRange>({ start: 0, end: 12 });
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [batchDone, setBatchDone] = useState(false);
  const batchOutputs = useRef(new Map<string, { blob: Blob; name: string }>());
  const [sheet, setSheet] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);
  // Canvas editor tools: the edit (crop box, turns) the engine applies.
  const ratioOf = preset.editor?.ratio;
  const ratio = ratioOf?.(options) ?? null;
  const editor = useEditor(ratio);
  const resetEditor = editor.reset;
  const editing = tool.ui === 'canvas-editor' && !preset.editor?.compare;
  const [cropSheet, setCropSheet] = useState(false);
  // P07: the Refine brush over the result.
  const [refining, setRefining] = useState(false);
  // Media tools: what the probe found, and the timeline's frames.
  const [media, setMedia] = useState<ProbeInfo | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);

  const track = useCallback(
    (name: string, props: Record<string, string> = {}) => {
      onEvent?.(name, { tool_id: tool.id, ...props });
    },
    [onEvent, tool.id],
  );

  useEffect(() => {
    const owned = urls.current;
    return () => {
      for (const url of owned) URL.revokeObjectURL(url);
    };
  }, []);

  const run = useCallback(
    async (input: InputInfo, file: File, values: Record<string, string> = options) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const started = performance.now();
      track('tool_run_started', { path: 'client' });
      setState({ kind: 'running', input, fraction: 0, elapsedSec: 0 });
      try {
        const edit = editor.edit;
        const out = await engine.run(
          file,
          {
            ...engineOptions,
            ...values,
            ...(editing && { crop: edit.crop ?? undefined, turns: edit.turns, flip: edit.flip }),
            ...(tool.ui === 'timeline' && { start: range.start, end: range.end }),
          },
          {
            signal: abort.signal,
            progress: (fraction, stage, detail) => {
              setState({
                kind: 'running',
                input,
                fraction,
                stage,
                amount: detail?.amount,
                step: detail?.step,
                elapsedSec: (performance.now() - started) / 1000,
              });
            },
          },
        );
        const url = URL.createObjectURL(out.blob);
        urls.current.push(url);
        const text =
          preset.preview === 'text'
            ? (await out.blob.text()).slice(0, TEXT_PREVIEW_CHARS)
            : undefined;
        const seconds = (performance.now() - started) / 1000;
        track('tool_run_succeeded', {
          engine_path: out.path,
          duration: durationBucket(seconds * 1000),
        });
        setState({
          kind: 'result',
          input,
          file,
          output: {
            size: out.blob.size,
            // The engine knows the real format ("Keep format" depends on the input).
            ext: out.ext || preset.outputExt(values),
            url,
            blob: out.blob,
            seconds,
            path: out.path,
            width: out.width ?? input.width,
            height: out.height ?? input.height,
            notes: out.notes,
            details: out.details,
            text,
          },
        });
      } catch (error) {
        if (abort.signal.aborted) {
          setState({ kind: 'empty' });
          return;
        }
        track('tool_run_failed', { error_code: 'engine', engine_path: 'client' });
        setState({
          kind: 'error',
          label: "Couldn't process this file",
          title: 'Something went wrong while processing',
          // Engines write whole sentences; don't double the full stop.
          body: `${(error instanceof Error ? error.message : 'Unknown error').replace(/\.$/, '')}. Try again, or try another file.`,
        });
      }
    },
    [editing, editor.edit, engine, engineOptions, options, preset, range, tool.ui, track],
  );

  /** Media tools read the file first: its length sets up the timeline. */
  const inspect = useCallback(
    async (input: InputInfo, file: File, files: File[]) => {
      if (!preset.probe) return;
      setMedia(null);
      setThumbs([]);
      setState({ kind: 'running', input, stage: 'Reading the file', elapsedSec: 0 });
      let info: ProbeInfo;
      try {
        info = await preset.probe(file);
      } catch (error) {
        setState({
          kind: 'error',
          label: "Couldn't read this file",
          title: 'This file won’t work here',
          body: error instanceof Error ? error.message : 'It couldn’t be read.',
        });
        return;
      }
      setMedia(info);
      setRange(preset.initialRange?.(info.durationSec) ?? { start: 0, end: info.durationSec });
      setState({ kind: 'ready', input: { ...input, durationSec: info.durationSec }, files });
      void info
        .thumbnails?.(12)
        .then((frames) => {
          urls.current.push(...frames.filter(Boolean));
          setThumbs(frames);
        })
        .catch(() => undefined);
    },
    [preset],
  );

  const intake = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      resetEditor();
      setRefining(false);
      // Refine strokes belong to the last image.
      const refineId = preset.editor?.refine;
      if (refineId) setOptions((current) => ({ ...current, [refineId]: '' }));
      if (preset.maxFiles && files.length > preset.maxFiles) {
        setState({
          kind: 'error',
          label: 'Too many files',
          title: `Up to ${String(preset.maxFiles)} files at once`,
          body: `You added ${String(files.length)}. Choose ${String(preset.maxFiles)} or fewer and try again.`,
        });
        return;
      }
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      const input: InputInfo = { name: file.name, size: file.size, url };
      track('tool_file_added', {
        mime: file.type.split('/')[0] || 'unknown',
        size: sizeBucket(file.size),
      });
      // Batch tools, and form tools that take several files at once (T01).
      if (tool.ui === 'batch' || (preset.multiple && files.length > 1)) {
        batchOutputs.current.clear();
        setBatchDone(false);
        setBatch(
          files.map((f, i) => ({
            id: `${String(i)}-${f.name}`,
            name: f.name,
            size: f.size,
            status: 'queued',
          })),
        );
        setState({ kind: 'ready', input, files });
        return;
      }
      if (preset.probe) {
        void inspect(input, file, files);
        return;
      }
      if (preset.autoRun) void run(input, file);
      else setState({ kind: 'ready', input, files });
    },
    [inspect, preset, resetEditor, run, tool.ui, track],
  );

  async function trySample() {
    if (!preset.sampleUrl) return;
    const response = await fetch(preset.sampleUrl);
    const blob = await response.blob();
    intake([new File([blob], preset.sampleName ?? 'sample', { type: blob.type })]);
  }

  async function runBatch(files: File[]) {
    const abort = new AbortController();
    controller.current = abort;
    track('tool_run_started', { path: 'client', files: String(files.length) });
    for (const [index, file] of files.entries()) {
      const id = batch[index]?.id ?? String(index);
      const update = (patch: Partial<BatchItem>) => {
        setBatch((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
      };
      update({ status: 'running', progress: 0 });
      try {
        const out = await engine.run(
          file,
          { ...engineOptions, ...options },
          {
            signal: abort.signal,
            progress: (fraction) => {
              update({ progress: fraction });
            },
          },
        );
        batchOutputs.current.set(id, {
          blob: out.blob,
          name: outputName(file.name, preset.outputSuffix, out.ext),
        });
        update({ status: 'done', resultSize: out.blob.size, note: out.notes?.join('. ') });
      } catch (error) {
        if (abort.signal.aborted) return;
        update({
          status: 'failed',
          error: error instanceof Error ? error.message : "Couldn't read this file.",
        });
      }
    }
    setBatchDone(true);
  }

  const saveBlob = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }, []);

  const downloadItem = useCallback(
    (id: string) => {
      const item = batchOutputs.current.get(id);
      if (!item) return;
      saveBlob(item.blob, item.name);
      track('tool_download');
    },
    [saveBlob, track],
  );

  /** Every finished file in one ZIP; fflate loads only when this is used. */
  const downloadAll = useCallback(async () => {
    const { zipSync } = await import('fflate');
    const entries: Record<string, Uint8Array> = {};
    for (const { blob, name } of batchOutputs.current.values()) {
      let unique = name;
      for (let n = 2; unique in entries; n += 1)
        unique = name.replace(/(\.[^.]+)?$/, `-${String(n)}$1`);
      entries[unique] = new Uint8Array(await blob.arrayBuffer());
    }
    saveBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), `${tool.id}.zip`);
    track('tool_download', { files: String(batchOutputs.current.size) });
  }, [saveBlob, tool.id, track]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    setState({ kind: 'empty' });
    setBatch([]);
    setBatchDone(false);
    batchOutputs.current.clear();
    resetEditor();
    setMedia(null);
    setThumbs([]);
  }, [resetEditor]);

  /**
   * Sets an option; a new crop ratio refits the editor's box. Tools that run
   * as a file arrives run again with it (P07: a new background reuses the mask).
   */
  const changeOption = (id: string, value: string) => {
    const next = { ...options, [id]: value };
    setOptions(next);
    if (ratioOf) editor.applyRatio(ratioOf(next));
    if (preset.autoRun && state.kind === 'result' && state.file) {
      void run(state.input, state.file, next);
    }
  };

  const download = useCallback(() => {
    if (state.kind !== 'result' || !state.output.url) return;
    const a = document.createElement('a');
    a.href = state.output.url;
    a.download = outputName(state.input.name, preset.outputSuffix, state.output.ext);
    a.click();
    track('tool_download');
  }, [preset.outputSuffix, state, track]);

  // Esc cancels a run, Ctrl/Cmd+S downloads the result (docs/02 → keyboard).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Esc in a sheet or dialog closes it, and must not also cancel the run.
      const inDialog = event.target instanceof Element && event.target.closest('dialog') !== null;
      if (event.key === 'Escape' && state.kind === 'running' && !inDialog) {
        event.preventDefault();
        cancel();
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 's' &&
        state.kind === 'result'
      ) {
        event.preventDefault();
        download();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [cancel, download, state.kind]);

  const hasFile = state.kind === 'running' || state.kind === 'result' || state.kind === 'ready';
  const ext = (
    state.kind === 'result' ? state.output.ext : preset.outputExt(options)
  ).toUpperCase();
  const facts = preset.facts?.(state, options, media, range) ?? [];
  const phoneGroups = useMemo(
    () => preset.phoneGroups ?? preset.options.map((option) => [option.id]),
    [preset.options, preset.phoneGroups],
  );

  if (tool.ui === 'calculator') {
    if (!calculator) throw new Error(`${tool.id}: calculator tools pass their inputs and results`);
    return <CalculatorShell tool={tool} inputs={calculator.inputs} results={calculator.results} />;
  }

  const header = (
    <div className={cn(hasFile && 'max-lg:sr-only')}>
      <Breadcrumb
        items={[{ label: tool.category.name, href: tool.category.href }, { label: tool.name }]}
        className="px-4 pt-5.5 lg:px-0 lg:pt-0"
      />
      <h1 className="px-4 pt-3 text-34 leading-display font-display tracking-display text-balance lg:mt-4.5 lg:max-w-120 lg:px-0 lg:pt-0 lg:text-46">
        {tool.h1}
      </h1>
      <p className="px-4 pt-3 text-15.5 leading-body text-text-muted lg:mt-3.5 lg:px-0 lg:pt-0 lg:text-16.5">
        {tool.tagline}
      </p>
      <PrivacyBadge
        runtime={tool.runtime}
        noun={preset.noun}
        className="mt-4 px-4 lg:hidden"
        short
      />
      <PrivacyBadge runtime={tool.runtime} noun={preset.noun} className="mt-4 hidden lg:flex" />
    </div>
  );

  // Probed options take their choices from the file and hide when there is nothing to pick.
  const visibleOptions = preset.options
    .map((option) =>
      option.probed ? { ...option, choices: media?.choices?.[option.id] ?? [] } : option,
    )
    .filter(
      (option) =>
        optionVisible(option, options) && (!option.probed || (option.choices?.length ?? 0) > 1),
    );
  const showCrop = editing && state.kind === 'ready' && batch.length === 0;
  const blocked =
    state.kind === 'ready' ? preset.blocked?.(options, state.files?.length ?? 1) : undefined;
  const settings = (
    <OptionsPanel className="mt-6.5 hidden lg:block">
      {visibleOptions.map((option) => (
        <OptionRow key={option.id} label={option.label}>
          <OptionControl
            option={option}
            value={options[option.id] ?? option.default}
            onChange={(value) => {
              changeOption(option.id, value);
            }}
          />
        </OptionRow>
      ))}
      {showCrop && (
        <Suspense fallback={null}>
          <CropFields editor={editor} ratio={ratio} />
        </Suspense>
      )}
      {media?.summary && hasFile && <OptionFact label="File">{media.summary}</OptionFact>}
      {facts.map((fact) => (
        <OptionFact key={fact.label} label={fact.label}>
          {fact.value}
        </OptionFact>
      ))}
    </OptionsPanel>
  );

  const inBatch = batch.length > 0;
  const batchRunning = inBatch && !batchDone && batch.some((item) => item.status !== 'queued');
  const running = state.kind === 'running' || batchRunning;
  const result = state.kind === 'result';
  const actions = hasFile && (
    <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2.5 border-t border-border bg-bg px-4 pt-3 pb-6.5 lg:static lg:mt-6.5 lg:gap-3 lg:border-0 lg:bg-transparent lg:p-0">
      {inBatch ? (
        batchDone ? (
          <Button
            variant="primary"
            className="flex-1"
            disabled={batch.every((item) => item.status !== 'done')}
            onClick={() => void downloadAll()}
            icon={<Download aria-hidden="true" size={18} strokeWidth={2} />}
          >
            Download all · ZIP
          </Button>
        ) : (
          <Button
            variant="primary"
            className="flex-1"
            disabled={batchRunning || Boolean(blocked)}
            onClick={() => {
              if (state.kind === 'ready' && state.files) void runBatch(state.files);
            }}
          >
            {preset.runLabel ?? 'Start'} · {batch.length} files
          </Button>
        )
      ) : state.kind === 'ready' ? (
        <Button
          variant="primary"
          className="flex-1"
          disabled={Boolean(blocked)}
          onClick={() => {
            if (state.files?.[0]) void run(state.input, state.files[0]);
          }}
        >
          {preset.runLabel ?? 'Start'}
        </Button>
      ) : (
        <Button
          variant="primary"
          className="flex-1"
          disabled={!result}
          onClick={download}
          icon={<Download aria-hidden="true" size={18} strokeWidth={2} />}
        >
          <span>
            Download {ext}
            {result && (
              <span className="hidden lg:inline"> · {formatBytes(state.output.size)}</span>
            )}
          </span>
        </Button>
      )}
      {running ? (
        <Button className="w-28 lg:w-40" onClick={cancel}>
          Cancel
          <Kbd className="hidden border-0 px-0 text-11 font-body uppercase text-text-muted lg:inline">
            Esc
          </Kbd>
        </Button>
      ) : (
        <Button className="w-28 lg:w-40" onClick={cancel}>
          Start over
        </Button>
      )}
    </div>
  );

  const refineOption = preset.editor?.refine;
  const refineLink = state.kind === 'result' && refineOption && !refining && (
    <p className="mt-3.5 px-4 text-14 lg:px-0">
      <button
        type="button"
        className="link-accent"
        onClick={() => {
          setRefining(true);
        }}
      >
        Refine by hand
      </button>
      <span className="text-text-muted"> · keep or erase parts with a brush</span>
    </p>
  );

  const back = state.kind === 'result' && editing && state.file && (
    <p className="mt-3.5 px-4 text-14 lg:px-0">
      <button
        type="button"
        className="link-accent"
        onClick={() => {
          if (state.file) setState({ kind: 'ready', input: state.input, files: [state.file] });
        }}
      >
        Back to the editor
      </button>
    </p>
  );

  const next = result && tool.related.length > 0 && (
    <p className="mt-3.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 text-14 text-text-muted lg:px-0">
      <span>Next:</span>
      {tool.related.slice(0, 3).map((link) => (
        <AppLink
          key={link.href}
          href={link.href}
          className="link-accent"
          onClick={() => {
            onEvent?.('tool_handoff', { from_tool: tool.id, to_tool: link.href.slice(1) });
          }}
        >
          {link.name}
        </AppLink>
      ))}
    </p>
  );

  const preview = hasFile ? (
    <Workspace
      state={state}
      tool={tool}
      preset={preset}
      range={range}
      setRange={setRange}
      batch={batch}
      onDownloadItem={downloadItem}
      editor={editor}
      ratio={ratio}
      media={media}
      thumbs={thumbs}
      refine={
        refining && refineOption
          ? {
              strokes: readStrokes(options[refineOption]),
              apply: (strokes) => {
                setRefining(false);
                changeOption(refineOption, strokes.length ? JSON.stringify(strokes) : '');
              },
              cancel: () => {
                setRefining(false);
              },
            }
          : null
      }
    />
  ) : state.kind === 'error' ? (
    <div className="flex h-full flex-col justify-center bg-surface px-4 py-10 lg:px-18">
      <StatePanel
        tone="danger"
        label={state.label}
        title={state.title}
        body={state.body}
        actions={
          <Button variant="primary" onClick={cancel}>
            Try another file
          </Button>
        }
      />
    </div>
  ) : (
    <DropZone
      accept={preset.accept}
      multiple={preset.multiple}
      maxBytes={preset.maxBytes}
      noun={preset.noun}
      title={preset.dropTitle}
      chooseLabel={preset.chooseLabel}
      tapLabel={preset.tapLabel}
      formats={preset.formats}
      formatsShort={preset.formatsShort}
      camera={preset.camera}
      onFiles={intake}
      onReject={(message) => {
        setState({
          kind: 'error',
          label: "Couldn't read this file",
          title: 'This file won’t work here',
          body: message,
        });
      }}
      onSample={preset.sampleUrl ? () => void trySample() : undefined}
      active
    />
  );

  return (
    <div className="lg:grid lg:min-h-[calc(100dvh-var(--header-h))] lg:grid-cols-[var(--tool-left-col)_1fr]">
      <section
        aria-label="Settings"
        className={cn(
          'flex flex-col lg:border-r lg:border-border lg:px-10 lg:pt-8.5 lg:pb-10',
          hasFile && 'max-lg:order-2',
        )}
      >
        {header}
        {settings}
        {actions}
        {blocked && (
          <p role="status" className="mt-3.5 px-4 text-14 leading-body text-text-muted lg:px-0">
            {blocked}
          </p>
        )}
        {state.kind === 'ready' && media?.warnings && media.warnings.length > 0 && (
          <Notes title="Before you start" notes={media.warnings} className="mt-6 px-4 lg:px-0" />
        )}
        {running && preset.runningNote && (
          <p className="mt-3.5 hidden text-14 leading-body text-text-muted lg:block">
            {preset.runningNote}
          </p>
        )}
        {result && state.output.notes && state.output.notes.length > 0 && (
          <Notes notes={state.output.notes} className="mt-6 hidden lg:block" />
        )}
        {(back || next) && (
          <div className="hidden lg:block">
            {refineLink}
            {back}
            {next}
          </div>
        )}
        {state.kind === 'empty' && tool.howTo && (
          <NumberedList items={tool.howTo} className="mt-7.5 hidden lg:block" />
        )}
      </section>

      <section
        aria-label="Workspace"
        className={cn('relative lg:min-h-0', hasFile ? 'max-lg:order-1' : 'max-lg:pb-8')}
      >
        {preview}
      </section>

      {/* Phone result: title, settings as tappable rows, handoff links. */}
      {hasFile && (
        <div className="pb-28 lg:hidden">
          {result && (
            <h2 className="px-4 pt-4 text-24 leading-title font-display tracking-title">
              {preset.resultTitle}
            </h2>
          )}
          {result && state.output.notes && state.output.notes.length > 0 && (
            <Notes notes={state.output.notes} className="mx-4 mt-4" />
          )}
          <div className="mx-4 mt-4 rounded-card border border-border">
            {showCrop && editor.edit.crop && (
              <button
                type="button"
                onClick={() => {
                  setCropSheet(true);
                }}
                className="flex h-12 w-full items-center justify-between border-b border-border px-3.5 text-14.5 last:border-b-0"
              >
                <span className="text-text-muted">Crop box</span>
                <span className="flex items-center gap-1.5 font-strong">
                  {boxLabel(editor.edit.crop)}
                  <ChevronRight aria-hidden="true" size={16} strokeWidth={2} />
                </span>
              </button>
            )}
            {/* What the probe read from the file (media tools). */}
            {media?.summary && (
              <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border px-3.5 py-2 text-14.5 last:border-b-0">
                <span className="text-text-muted">File</span>
                <span className="text-right font-mono text-12.5 uppercase text-text-muted">
                  {media.summary}
                </span>
              </div>
            )}
            {phoneGroups.map((group, index) => {
              const groupOptions = group
                .map((id) => visibleOptions.find((option) => option.id === id))
                .filter((option): option is ShellOption => Boolean(option));
              if (groupOptions.length === 0) return null;
              return (
                <button
                  key={group.join('-')}
                  type="button"
                  onClick={() => {
                    setSheet(index);
                  }}
                  className="flex h-12 w-full items-center justify-between border-b border-border px-3.5 text-14.5 last:border-b-0"
                >
                  <span className="text-text-muted">
                    {groupOptions.map((option) => option.label).join(' · ')}
                  </span>
                  <span className="flex items-center gap-1.5 font-strong">
                    {groupOptions
                      .map((option) => optionSummary(option, options[option.id] ?? option.default))
                      .join(' · ')}
                    <ChevronRight aria-hidden="true" size={16} strokeWidth={2} />
                  </span>
                </button>
              );
            })}
          </div>
          {refineLink}
          {back}
          {next}
          {showCrop && (
            <Dialog
              open={cropSheet}
              onClose={() => {
                setCropSheet(false);
              }}
              title="Crop box"
              variant="sheet"
            >
              <Suspense fallback={null}>
                <CropFields editor={editor} ratio={ratio} />
              </Suspense>
            </Dialog>
          )}
          <Dialog
            open={sheet !== null}
            onClose={() => {
              setSheet(null);
            }}
            title="Settings"
            variant="sheet"
          >
            {(phoneGroups[sheet ?? 0] ?? []).map((id) => {
              const option = visibleOptions.find((candidate) => candidate.id === id);
              if (!option) return null;
              return (
                <OptionRow key={option.id} label={option.label}>
                  <OptionControl
                    option={option}
                    value={options[option.id] ?? option.default}
                    onChange={(value) => {
                      changeOption(option.id, value);
                    }}
                  />
                </OptionRow>
              );
            })}
          </Dialog>
        </div>
      )}
    </div>
  );
}

/** What a run changed or dropped (e.g. "12 style overrides removed"), in plain words. */
function Notes({
  notes,
  title = 'What changed',
  className,
}: {
  notes: string[];
  title?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
        {title}
      </p>
      <ul className="mt-2.5 border-t border-border">
        {notes.map((note) => (
          <li
            key={note}
            className="flex items-baseline gap-2.5 border-b border-border py-2.5 text-14"
          >
            <span
              aria-hidden="true"
              className="size-1.5 flex-none translate-y-[-2px] rounded-full bg-text-muted"
            />
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InputPreview({ input, noun, dim }: { input: InputInfo; noun: Noun; dim?: boolean }) {
  return (
    <div className="absolute inset-0">
      {noun === 'image' && input.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URLs, nothing to optimise
        <img src={input.url} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full flex-col items-start justify-center bg-surface px-4 lg:px-18">
          <p className="font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
            Your {noun}
          </p>
          <p className="mt-3 max-w-full truncate text-24 font-display tracking-title">
            {input.name}
          </p>
          <p className="mt-2 font-mono text-12.5 uppercase text-text-muted">
            {formatBytes(input.size)}
          </p>
        </div>
      )}
      {dim && <div aria-hidden="true" className="absolute inset-0 bg-media-scrim/35" />}
      <MediaTag className="left-3.5">Original</MediaTag>
    </div>
  );
}

function Workspace({
  state,
  tool,
  preset,
  range,
  setRange,
  batch,
  onDownloadItem,
  editor,
  ratio,
  media,
  thumbs,
  refine,
}: {
  state: ShellState;
  tool: ShellTool;
  preset: ShellPreset;
  range: TimelineRange;
  setRange: (range: TimelineRange) => void;
  batch: BatchItem[];
  onDownloadItem: (id: string) => void;
  editor: EditorState;
  ratio: number | null;
  media: ProbeInfo | null;
  thumbs: string[];
  refine: {
    strokes: BrushStroke[];
    apply: (strokes: BrushStroke[]) => void;
    cancel: () => void;
  } | null;
}) {
  if (state.kind !== 'running' && state.kind !== 'result' && state.kind !== 'ready') return null;
  const frame = 'relative h-98 overflow-hidden lg:absolute lg:inset-0 lg:h-auto';

  if (tool.ui === 'batch' || batch.length > 0) {
    return (
      <div className="px-4 py-6 lg:px-10 lg:pt-8.5">
        <BatchList items={batch} onDownload={onDownloadItem} />
      </div>
    );
  }

  if (tool.ui === 'timeline' && state.kind === 'ready') {
    return (
      <TimelineWorkspace
        url={state.input.url}
        video={preset.noun === 'video'}
        durationSec={media?.durationSec ?? 60}
        fps={media?.fps}
        thumbs={thumbs}
        range={range}
        setRange={setRange}
      />
    );
  }

  if (
    tool.ui === 'canvas-editor' &&
    state.kind === 'ready' &&
    !preset.editor?.compare &&
    state.input.url
  ) {
    return (
      <div className={frame}>
        <Suspense fallback={null}>
          <CanvasEditor
            src={state.input.url}
            editor={editor}
            ratio={ratio}
            initialMode={preset.editor?.mode}
            enabledModes={preset.editor?.modes}
          />
        </Suspense>
      </div>
    );
  }

  if (state.kind === 'running' || state.kind === 'ready') {
    return (
      <div className={frame}>
        <InputPreview input={state.input} noun={preset.noun} dim={state.kind === 'running'} />
        {state.kind === 'running' && (
          <ProgressBar
            className="max-lg:inset-x-4 max-lg:bottom-4"
            title={preset.progressTitle?.(state.stage) ?? state.stage ?? 'Working'}
            fraction={state.fraction}
            meta={{ amount: state.amount, step: state.step, elapsedSec: state.elapsedSec }}
          />
        )}
      </div>
    );
  }

  const { input, output } = state;
  if (refine && input.url && output.url && output.width && output.height) {
    return (
      <div className={frame}>
        <Suspense fallback={null}>
          <RefineBrush
            result={output.url}
            original={input.url}
            width={output.width}
            height={output.height}
            strokes={refine.strokes}
            onApply={refine.apply}
            onCancel={refine.cancel}
          />
        </Suspense>
      </div>
    );
  }
  if (tool.ui === 'analyzer') {
    return (
      <div className="px-4 py-6 lg:px-10 lg:pt-8.5">
        <FactGrid facts={preset.analyze?.(input) ?? []} />
      </div>
    );
  }

  const dims =
    output.width && output.height
      ? `${String(output.width)} × ${String(output.height)} px`
      : undefined;
  const facts: Fact[] = [
    ...(dims ? [{ label: 'Dimensions', value: dims }] : []),
    ...(output.details ?? []),
    { label: 'Size', value: `${formatBytes(input.size)} → ${formatBytes(output.size)}` },
    { label: 'Time', value: `${output.seconds.toFixed(1)} s` },
    { label: 'Engine', value: output.path },
  ];

  if (preset.preview === 'text' && output.text !== undefined) {
    const name = outputName(input.name, preset.outputSuffix, output.ext);
    return (
      <>
        <div className={cn(frame, 'flex flex-col bg-surface')}>
          <div className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-3.5 lg:px-10">
            <p className="font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
              Preview
            </p>
            <p className="truncate font-mono text-12.5 text-text">{name}</p>
          </div>
          <pre
            tabIndex={0}
            aria-label={`Start of ${name}`}
            className="min-h-0 flex-1 overflow-auto px-4 pt-4 pb-24 font-mono text-13 leading-body whitespace-pre-wrap lg:px-10"
          >
            {output.text}
          </pre>
          <Readout facts={facts} className="hidden lg:flex" />
        </div>
        <div className="lg:hidden">
          <ReadoutRow
            facts={[
              ...(output.details ?? []).map((detail) => ({
                label: detail.label,
                value: detail.value,
              })),
              { label: 'Size', value: formatBytes(output.size), unit: output.ext.toUpperCase() },
            ]}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div className={frame}>
        {output.url && output.blob && /^(video|audio)\//.test(output.blob.type) ? (
          <div className="absolute inset-0 flex items-center justify-center bg-media-scrim p-6 pb-24">
            {output.blob.type.startsWith('video/') ? (
              <video
                src={output.url}
                controls
                playsInline
                aria-label="Result"
                className="max-h-full max-w-full"
              />
            ) : (
              <audio src={output.url} controls aria-label="Result" className="w-full max-w-120" />
            )}
            <MediaTag className="left-3.5">Result</MediaTag>
          </div>
        ) : (isImage(preset) || output.blob?.type.startsWith('image/')) &&
          output.url &&
          preset.result === 'output' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface p-8 pb-24">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img
              src={output.url}
              alt="Result"
              className="checkerboard max-h-full max-w-full border border-border"
            />
            <MediaTag className="left-3.5">Result</MediaTag>
          </div>
        ) : isImage(preset) && input.url && output.url ? (
          <BeforeAfter
            className="absolute inset-0"
            compact
            before={
              // eslint-disable-next-line @next/next/no-img-element -- local object URL
              <img src={input.url} alt="" className="size-full object-cover" />
            }
            after={
              // eslint-disable-next-line @next/next/no-img-element -- local object URL
              <img src={output.url} alt="Result" className="size-full object-cover" />
            }
          />
        ) : (
          <InputPreview
            input={{
              ...input,
              name: outputName(input.name, preset.outputSuffix, output.ext),
              size: output.size,
            }}
            noun={preset.noun}
          />
        )}
        <Readout facts={facts} className="hidden lg:flex" />
      </div>
      <div className="lg:hidden">
        <ReadoutRow
          facts={[
            ...(output.width && output.height
              ? [
                  {
                    label: 'Dimensions',
                    value: `${String(output.width)} × ${String(output.height)}`,
                    unit: 'px',
                  },
                ]
              : []),
            { label: 'Size', value: formatBytes(output.size), unit: output.ext.toUpperCase() },
            { label: 'Time', value: `${output.seconds.toFixed(1)} s` },
          ]}
        />
      </div>
    </>
  );
}

/**
 * Trim-type tools: the clip on top (following the playhead and handles), the
 * timeline below. Browsers that can't play the codec still show the frames.
 */
function TimelineWorkspace({
  url,
  video,
  durationSec,
  fps,
  thumbs,
  range,
  setRange,
}: {
  url?: string;
  video: boolean;
  durationSec: number;
  fps?: number;
  thumbs: string[];
  range: TimelineRange;
  setRange: (range: TimelineRange) => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  return (
    <div className="flex flex-col gap-5 px-4 py-6 lg:px-10 lg:pt-8.5">
      {video && url && (
        <video
          ref={player}
          src={url}
          controls
          muted
          playsInline
          preload="metadata"
          aria-label="Your video"
          className="aspect-video max-h-[46dvh] w-full bg-media-scrim object-contain"
        />
      )}
      <Suspense fallback={null}>
        <Timeline
          durationSec={durationSec}
          fps={fps ? Math.round(fps) : undefined}
          kind={video ? 'video' : 'audio'}
          value={range}
          onChange={setRange}
          thumbnails={thumbs}
          onSeek={(time) => {
            if (player.current && player.current.readyState > 0) player.current.currentTime = time;
          }}
        />
      </Suspense>
    </div>
  );
}
