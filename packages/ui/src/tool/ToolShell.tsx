'use client';

import type { CheckRules } from '@etb/core/subtitles';
import { activeAreas, isNeutral, type Engine, type NamesPlan } from '@etb/engines';
import { ChevronRight, Download, Monitor } from 'lucide-react';
import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { cn } from '../cn';
import { AppLink } from '../primitives/AppLink';
import { Breadcrumb } from '../primitives/Breadcrumb';
import { Button, ButtonLink } from '../primitives/Button';
import { Kbd } from '../primitives/Kbd';
import { NumberedList } from '../primitives/NumberedList';
import { OptionFact, OptionRow, OptionsPanel, OptionStack } from '../primitives/OptionsPanel';
import { ColorInput, Input, NumberWithUnit, Select, Slider } from '../primitives/fields';
import { Dialog } from '../primitives/overlays';
import type { PresetGroup } from '../primitives/PresetPicker';
import { PrivacyBadge, type Noun } from '../primitives/PrivacyBadge';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { StatePanel } from '../primitives/states';
import type { BatchItem } from './BatchList';
import { BeforeAfter, MediaTag } from './BeforeAfter';
import type { FaceFinder } from './BlurLayer';
import { CalculatorShell } from './CalculatorShell';
import type { EditorMode } from './CanvasEditor';
import { boxLabel } from './crop';
import { DropZone } from './DropZone';
import type { GridFact } from './FactGrid';
import type { OrderedFile } from './FileOrder';
import type * as FolderRename from './FolderRename';
import type { Renamed } from './in-place';
import type { SwatchInfo } from './Swatches';
import { accepts, handOff, takeHandoff } from './handoff';
import { durationBucket, formatBytes, outputName, plural, sizeBucket } from './format';
import { ProgressBar } from './ProgressBar';
import type { FocusFrame } from './FocusPicker';
import type { GraphInfo } from './LineGraph';
import { MASK_MODES, parseStrokes, type MaskStroke } from './brush';
import type { BrushStroke } from './RefineBrush';
import { Readout, ReadoutRow, type Fact } from './Readout';
import type { PreviewResult, ServerAccount, ServerInfo, ServerQuote, ShellServer } from './server';
import type * as ServerPath from './ServerNotice';
import type { TimelineRange } from './Timeline';
import type { MultiRange } from './TimelineWorkspace';
import { useEditor, type EditorState } from './useEditor';

// Workspaces and controls only some tools use load when shown, so each tool
// page carries only its own (docs/10 → initial JS on a tool page).
const BatchList = lazy(() => import('./BatchList').then((m) => ({ default: m.BatchList })));
const FactGrid = lazy(() => import('./FactGrid').then((m) => ({ default: m.FactGrid })));
const FileOrder = lazy(() => import('./FileOrder').then((m) => ({ default: m.FileOrder })));
const PositionGrid = lazy(() =>
  import('../primitives/PositionGrid').then((m) => ({ default: m.PositionGrid })),
);
const PresetChecklist = lazy(() =>
  import('../primitives/PresetPicker').then((m) => ({ default: m.PresetChecklist })),
);
const CanvasEditor = lazy(() =>
  import('./CanvasEditor').then((m) => ({ default: m.CanvasEditor })),
);
const ColorPicker = lazy(() => import('./ColorPicker').then((m) => ({ default: m.ColorPicker })));
const SubtitleWorkspace = lazy(() =>
  import('./SubtitleEditor').then((m) => ({ default: m.SubtitleWorkspace })),
);
const FocusPicker = lazy(() => import('./FocusPicker').then((m) => ({ default: m.FocusPicker })));
const LineGraph = lazy(() => import('./LineGraph').then((m) => ({ default: m.LineGraph })));
const CropFields = lazy(() => import('./CropFields').then((m) => ({ default: m.CropFields })));
const RefineBrush = lazy(() => import('./RefineBrush').then((m) => ({ default: m.RefineBrush })));
const MaskBrush = lazy(() => import('./MaskBrush').then((m) => ({ default: m.MaskBrush })));
const Swatches = lazy(() => import('./Swatches').then((m) => ({ default: m.Swatches })));

/** Tailwind's `lg` breakpoint: two columns from here up. */
const WIDE = '(min-width: 64rem)';
/** How often a running batch redraws its rows. */
const BATCH_DRAW_MS = 120;

function subscribeWide(onChange: () => void) {
  const query = matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}
const TimelineWorkspace = lazy(() =>
  import('./TimelineWorkspace').then((m) => ({ default: m.TimelineWorkspace })),
);
const ABPlayer = lazy(() => import('./ABPlayer').then((m) => ({ default: m.ABPlayer })));

/** A server tool's free preview (A10): not run, on its way, ready to play, or failed. */
type PreviewState =
  | { kind: 'idle' }
  | { kind: 'running'; stage: string; fraction?: number; amount?: string; elapsedSec: number }
  | { kind: 'done'; result: PreviewResult; options: string; at: number }
  | { kind: 'error'; message: string };

/** What the shell needs from the registry entry (serialisable, no Zod). */
export interface ShellTool {
  id: string;
  name: string;
  h1: string;
  tagline: string;
  runtime: 'client' | 'hybrid' | 'server-cpu' | 'server-gpu';
  ui: 'canvas-editor' | 'timeline' | 'form' | 'analyzer' | 'calculator' | 'batch';
  category: { name: string; href: string };
  /** Related tools; those with `accepts` can take this tool's result (the handoff). */
  related: { name: string; href: string; id?: string; accepts?: string[] }[];
  howTo?: string[];
  /** Set when the tool's server path is on (the server build reads it from the database). */
  server?: ServerInfo;
  /** Small screens get a note that it works best on a computer (docs/01 → Mobile). */
  desktopBest?: boolean;
}

export interface ShellOption {
  id: string;
  label: string;
  /**
   * choice (default): a segmented control. select: a dropdown, for longer
   * lists. slider and number: a value with its unit. color: a swatch, value
   * "#rrggbb". image: a second image to pick (a new background), value an
   * object URL. text: typed in, such as a time ("00:01:02.500"). checklist:
   * several choices at once, grouped (P13's sizes), value the picked values
   * comma-separated. grid: one of nine spots on a 3 × 3 grid (a watermark's
   * place), the choices in reading order. textarea: several lines pasted
   * in (U04's expected hashes).
   */
  kind?:
    | 'choice'
    | 'select'
    | 'slider'
    | 'number'
    | 'color'
    | 'image'
    | 'text'
    | 'file'
    | 'checklist'
    | 'grid'
    | 'textarea';
  /** file: the types the picker offers (".srt,.vtt,.ass"). */
  accept?: string;
  /** text: an example shown while it's empty. */
  placeholder?: string;
  /** checklist: `group` heads a set of choices, `detail` is its numbers ("1080 × 1350"). */
  choices?: { value: string; label: string; group?: string; detail?: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default: string;
  /** Shown only while another option has one of these values (quality only for lossy formats). */
  when?: { id: string; values: string[] };
  /** Choices come from the file (the preset's probe), and the option shows only when there are two or more. */
  probed?: boolean;
  /** Shown only for one file (the editor's settings) or several (a batch's). */
  files?: 'one' | 'many';
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
  if (option.kind === 'file') return value ? fileOptionName(value) : 'None';
  if (option.kind === 'text') return value || 'None';
  if (option.kind === 'textarea') {
    const lines = value.split('\n').filter((line) => line.trim()).length;
    return lines === 0 ? 'None' : plural(lines, 'line');
  }
  if (option.kind === 'checklist') {
    const picked = value.split(',').filter(Boolean);
    if (picked.length === 1) {
      const choice = option.choices?.find((candidate) => candidate.value === picked[0]);
      return choice ? [choice.group, choice.label].filter(Boolean).join(' · ') : '1 chosen';
    }
    return picked.length === 0 ? 'None' : `${String(picked.length)} chosen`;
  }
  return option.choices?.find((choice) => choice.value === value)?.label ?? value;
}

/** The files behind `file` options' values, so a run can take the file itself. */
const OPTION_FILES = new Map<string, File>();

/**
 * A `file` option's value: an object URL with the file's name after `#`, so
 * the name (and its extension) stays on the page with the file.
 */
export function fileOptionValue(file: File): string {
  const value = `${URL.createObjectURL(file)}#${encodeURIComponent(file.name)}`;
  OPTION_FILES.set(value, file);
  return value;
}

/** The file a `file` option holds (no fetch of its object URL, which the CSP may not allow). */
export function fileOptionFile(value: string): File | undefined {
  return OPTION_FILES.get(value);
}

export function fileOptionName(value: string): string {
  const hash = value.indexOf('#');
  return hash < 0 ? 'Chosen' : decodeURIComponent(value.slice(hash + 1));
}

/**
 * A second file for an option: an image (a new background) or any file the
 * option accepts (subtitles). A button, then its name.
 */
function ImagePick({
  label,
  value,
  onChange,
  accept = 'image/*',
  named = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accept?: string;
  /** The value carries the file's name (`file` options). */
  named?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  return (
    <span className="flex min-w-0 items-center gap-3">
      {value && (
        <span className="max-w-40 truncate text-14 text-text-muted">
          {named ? fileOptionName(value) : (name ?? 'Image chosen')}
        </span>
      )}
      <Button size="sm" onClick={() => input.current?.click()}>
        {value ? 'Change' : named ? 'Choose file' : 'Choose image'}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          if (value.startsWith('blob:')) URL.revokeObjectURL(value.split('#')[0] ?? value);
          OPTION_FILES.delete(value);
          setName(file.name);
          onChange(named ? fileOptionValue(file) : URL.createObjectURL(file));
        }}
      />
    </span>
  );
}

/** A settings row: label and control side by side, or stacked for a checklist. */
function OptionLine({ option, children }: { option: ShellOption; children: ReactNode }) {
  return option.kind === 'checklist' ? (
    <OptionStack label={option.label}>{children}</OptionStack>
  ) : (
    <OptionRow label={option.label}>{children}</OptionRow>
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
  if (option.kind === 'text') {
    // A set width on a wrapper: the field itself fills what it's in.
    return (
      <span className="block w-40">
        <Input
          aria-label={option.label}
          placeholder={option.placeholder}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </span>
    );
  }
  if (option.kind === 'textarea') {
    return (
      <textarea
        aria-label={option.label}
        placeholder={option.placeholder}
        spellCheck={false}
        autoComplete="off"
        rows={3}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="block w-full min-w-0 resize-y rounded-control border border-border bg-bg px-3 py-2 font-mono text-12.5 text-text placeholder:text-text-muted hover:border-text focus-visible:border-text sm:w-72"
      />
    );
  }
  if (option.kind === 'color') {
    return <ColorInput label={option.label} value={value} onChange={onChange} />;
  }
  if (option.kind === 'image') {
    return <ImagePick label={option.label} value={value} onChange={onChange} />;
  }
  if (option.kind === 'file') {
    return (
      <ImagePick
        label={option.label}
        value={value}
        onChange={onChange}
        accept={option.accept}
        named
      />
    );
  }
  if (option.kind === 'checklist') {
    const groups: PresetGroup[] = [];
    for (const choice of option.choices ?? []) {
      const label = choice.group ?? '';
      let group = groups.find((candidate) => candidate.label === label);
      if (!group) {
        group = { label, presets: [] };
        groups.push(group);
      }
      group.presets.push({ id: choice.value, label: choice.label, detail: choice.detail ?? '' });
    }
    return (
      <Suspense fallback={null}>
        <PresetChecklist groups={groups} value={value} onChange={onChange} label={option.label} />
      </Suspense>
    );
  }
  if (option.kind === 'grid') {
    return (
      <Suspense fallback={null}>
        <PositionGrid
          label={option.label}
          options={option.choices ?? []}
          value={value}
          onChange={onChange}
        />
      </Suspense>
    );
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
  /** Once there's a result, a changed setting runs it again (C05's intensity), when nothing blocks the run. */
  rerun?: boolean;
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
    /** P12: blur mode's "Find faces". */
    findFaces?: FaceFinder;
    /** P01: the modes in a rail on the left (a bar along the bottom on phones). */
    layout?: 'bar' | 'rail';
  };
  /**
   * C02: the image becomes a colour picker. Picks are kept (as a JSON list of
   * HEX, newest first) in the `history` option, which the engine turns into
   * the download; `sample` and `zoom` are the options for the block size and
   * the loupe.
   */
  picker?: { history: string; sample: string; zoom: string };
  /**
   * P13: the image takes a focal point (click, drag or arrow keys), kept in
   * `option` as "x,y" shares of the width and height. `frames` are the sizes
   * it's made into, outlined on the image; shown while `when` holds.
   */
  focus?: {
    option: string;
    frames: (options: Record<string, string>) => FocusFrame[];
    when?: (options: Record<string, string>) => boolean;
  };
  /**
   * P17: before the run, the image takes a mask brush (mark what to remove).
   * The strokes are kept as JSON, in image px, in `option`; the page turns
   * them into the mask it sends.
   */
  mask?: { option: string };
  /**
   * A03: a tap tempo pad and a metronome under the settings, file or not. The
   * tool's view passes them (`<TempoTools />`), so their code ships with that
   * tool's page alone and is in the server's HTML in place: a lazy part here
   * reached the page after its first paint and pushed the drop zone down.
   */
  tempo?: ReactNode;
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
  /**
   * A04, V12: several files become one. They are listed in order, to move,
   * remove or add to, and the engine gets them all as `files`. `describe`
   * reads each one's length and what it holds for the list.
   */
  combine?: {
    min: number;
    max: number;
    /** A line under each file; a duration adds a total (media), images have none (P18). */
    describe?: (file: File) => Promise<{ durationSec?: number; summary: string }>;
  };
  /**
   * A11: the timeline's ranges are found in the file (the silences to cut),
   * and found again when an option in `deps` changes. Each can be moved or
   * dropped like any range. While searching the run waits and says `busy`;
   * with none found, it says `empty`.
   */
  detect?: {
    deps: string[];
    run: (file: File, options: Record<string, string>) => Promise<TimelineRange[]>;
    busy: string;
    empty: string;
  };
  /** A server tool: why it runs on our servers, for the offer ("Precise frame timing needs ffmpeg"). */
  serverReason?: string;
  /**
   * T03: the workspace is the subtitle editor. The cues live in the `cues`
   * option as JSON (the probe fills it from the file, the engine writes it
   * out); `media` is the file option holding the video or audio to play
   * along; `rules` are the checks' limits from the settings.
   */
  subtitles?: {
    cues: string;
    media: string;
    rules: (options: Record<string, string>) => CheckRules;
  };
  /**
   * U02: the files keep their bytes and get new names. `plan` names every
   * file from the settings; the list shows each new name and what's wrong
   * with it, and a name that can't be used stops the run. With `inPlace`,
   * desktop Chromium can open a folder and rename its files where they are.
   * Otherwise the renamed files download as a ZIP, built in memory, which
   * holds up to `zipMaxBytes` in all.
   */
  names?: {
    plan: (files: readonly File[], options: Record<string, string>) => Promise<NamesPlan>;
    inPlace?: boolean;
    zipMaxBytes: number;
  };
  /**
   * U04: each finished file's results checked against the settings without
   * running again (a pasted hash): a line under the file, or a problem.
   */
  batchCheck?: (item: BatchResult, options: Record<string, string>) => BatchVerdict | null;
  /** U04: one line over a batch's results: "The 2 files are identical". */
  batchSummary?: (items: BatchResult[], options: Record<string, string>) => string | null;
  /** U04: a batch gives values, not files, so its download is one list made from them, not a ZIP. */
  batchList?: {
    label: (options: Record<string, string>) => string;
    make: (items: BatchResult[], options: Record<string, string>) => { text: string; name: string };
  };
  /**
   * The timeline holds several ranges (V01, A02): the engine gets them all as
   * `ranges`, in order; `start` and `end` stay those of the selected one.
   */
  ranges?: boolean;
}

/** A finished batch file's values, for `batchCheck`, `batchSummary` and `batchList`. */
export interface BatchResult {
  name: string;
  size: number;
  facts: { label: string; value: string }[];
}

export interface BatchVerdict {
  note?: string;
  problem?: string;
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
  /** Whether the frames come on a steady clock (V15 checks before sending anything). */
  frameRate?: 'constant' | 'variable';
  /** Frames across the clip for the timeline strip (object URLs). */
  thumbnails?: (count: number) => Promise<string[]>;
  /** The audio's peaks (0-1) in `buckets` equal slices, for the waveform. */
  waveform?: (buckets: number) => Promise<number[]>;
  /** Choices for `probed` options, by option id (audio tracks). */
  choices?: Record<string, { value: string; label: string }[]>;
  /** Starting values the file suggests, by option id (the last cue for two-point sync). */
  values?: Record<string, string>;
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
  /** The download name's suffix, when the engine set one for this run. */
  suffix?: string;
  /** The whole download name, when the engine decided it (P18: after the first image in order). */
  name?: string;
  url?: string;
  blob?: Blob;
  seconds: number;
  path: string;
  width?: number;
  height?: number;
  /** What the engine changed or dropped, in plain words. */
  notes?: string[];
  /** Extra readout facts from the engine (cue count, source format). */
  details?: { label: string; value: string; unit?: string }[];
  /** A level over time, drawn under an analyzer's facts (A06). */
  graph?: GraphInfo;
  /** The start of a text output, for `preview: 'text'`. */
  text?: string;
  /** Colours found (C01), shown as a palette. */
  swatches?: SwatchInfo[];
}

/** Characters of a text output shown in the preview. */
const TEXT_PREVIEW_CHARS = 6000;

/** How long a replaced result's file stays readable, ms: a download just started from it finishes. */
const RESULT_GRACE_MS = 1000;

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
  | {
      kind: 'error';
      label: string;
      title: string;
      body: string;
      /** The file, when our servers can try it instead. */
      retry?: { input: InputInfo; file: File };
      /** Where to buy credits, when more would fix it and they're on sale. */
      buyHref?: string;
    };

export interface ToolShellProps {
  tool: ShellTool;
  preset: ShellPreset;
  /** The browser engine; a server tool (runtime server-cpu or server-gpu) has none. */
  engine?: Engine;
  /** Engine options passed through (the dummy engine's duration and stages). */
  engineOptions?: Record<string, unknown>;
  /** Start in a given state: design screens and tests. */
  initialState?: ShellState;
  initialOptions?: Record<string, string>;
  /** Analytics events from docs/09 (bucketed, no file names or contents). */
  onEvent?: (name: string, props: Record<string, string>) => void;
  /** Calculator tools: their own inputs and live results, in the shared layout. */
  calculator?: { inputs: ReactNode; results: ReactNode };
  /** A hybrid tool's server path, once an admin has switched it on (docs/02 → Routing). */
  server?: ShellServer;
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
  server,
}: ToolShellProps) {
  const [state, setState] = useState<ShellState>(initialState ?? { kind: 'empty' });
  // The server path: why it's offered for this file, the account, and a price to confirm.
  // Its notice, terms and errors load with a tool whose server path is on.
  const [serverPath, setServerPath] = useState<typeof ServerPath | null>(null);
  const serverOn = Boolean(server);
  useEffect(() => {
    if (!serverOn) return;
    let live = true;
    void import('./ServerNotice').then((loaded) => {
      if (live) setServerPath(loaded);
    });
    return () => {
      live = false;
    };
  }, [serverOn]);
  const [serverReason, setServerReason] = useState<string | null>(null);
  const [account, setAccount] = useState<ServerAccount | null | undefined>(undefined);
  // Whether the current run is on our servers (the running note says where the work happens).
  const [onServer, setOnServer] = useState(false);
  const [asking, setAsking] = useState<{
    quote: ServerQuote;
    answer: (go: boolean) => void;
  } | null>(null);
  // A free preview of a snippet, played A/B (server.preview).
  const [snippet, setSnippet] = useState<PreviewState>({ kind: 'idle' });
  const previewAbort = useRef<AbortController | null>(null);
  const [options, setOptions] = useState<Record<string, string>>(
    initialOptions ?? defaults(preset.options),
  );
  // The timeline's ranges and the selected one change together. `found` counts the
  // times a file or a search set them, so an edit can tell it was made from older ones
  // (see changeRanges).
  const [timeline, setTimeline] = useState<{
    ranges: TimelineRange[];
    active: number;
    found: number;
  }>({ ranges: [{ start: 0, end: 12 }], active: 0, found: 0 });
  const { ranges, active: activeRange } = timeline;
  /** A04, V12: the files to join, in order. */
  const [queue, setQueue] = useState<(OrderedFile & { file: File })[]>([]);
  const queued = useRef(0);
  const addToQueue = useCallback(
    (files: File[]) => {
      const combine = preset.combine;
      if (!combine) return;
      const added = files.map((file) => ({
        id: String((queued.current += 1)),
        file,
        name: file.name,
        size: file.size,
      }));
      setQueue((current) => [...current, ...added].slice(0, combine.max));
      const update = (id: string, patch: Partial<OrderedFile>) => {
        setQueue((current) => current.map((q) => (q.id === id ? { ...q, ...patch } : q)));
      };
      for (const item of added) {
        combine.describe?.(item.file).then(
          (info) => {
            update(item.id, info);
          },
          (error: unknown) => {
            update(item.id, {
              error: error instanceof Error ? error.message : 'It can’t be read here.',
            });
          },
        );
      }
    },
    [preset.combine],
  );
  const moveQueued = useCallback((from: number, to: number) => {
    setQueue((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });
  }, []);
  // The files to join go to our servers together (their size, length and offer: ServerNotice.tsx).
  const joined = preset.combine && serverPath?.joinedFiles(queue, preset.maxBytes);
  /** A11: the ranges are being found in the file. */
  const [detecting, setDetecting] = useState(false);
  /** Which search is the latest, and the timer that waits for typing to stop. */
  const detectRound = useRef(0);
  const detectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Settings changed since the file arrived: what the file suggests doesn't override them. */
  const touched = useRef(new Set<string>());
  /** C05: a run again after a setting changes, once the slider stops moving. */
  const rerunTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectRanges = useCallback(
    async (file: File, values: Record<string, string>) => {
      const detect = preset.detect;
      if (!detect) return;
      const round = (detectRound.current += 1);
      setDetecting(true);
      try {
        const found = await detect.run(file, values);
        if (round !== detectRound.current) return;
        setTimeline((current) => ({ ranges: found, active: 0, found: current.found + 1 }));
      } catch {
        // Nothing to cut, then: the run waits and says why.
        if (round === detectRound.current)
          setTimeline((current) => ({ ranges: [], active: 0, found: current.found + 1 }));
      } finally {
        if (round === detectRound.current) setDetecting(false);
      }
    },
    [preset.detect],
  );
  const range = useMemo(
    () => ranges[activeRange] ?? ranges[0] ?? { start: 0, end: 12 },
    [ranges, activeRange],
  );
  const setRange = useCallback((next: TimelineRange) => {
    setTimeline((current) => ({
      ...current,
      ranges: current.ranges.map((r, i) => (i === current.active ? next : r)),
    }));
  }, []);
  /**
   * The timeline edits the ranges it drew. Parts found by a search can land
   * after that drawing and before the edit (A14: "By hand" picked, In typed as
   * its one part arrives); the edit, made from the old parts, would bring them
   * all back and keep them. So it's dropped, and the parts found stand, as
   * they do over any edit made before they came. Edits made from the same
   * parts (a drag's moves between two renders) all apply.
   */
  const drawnFrom = timeline.found;
  const changeRanges = useCallback(
    (next: TimelineRange[], active: number) => {
      setTimeline((current) =>
        current.found === drawnFrom ? { ...current, ranges: next, active } : current,
      );
    },
    [drawnFrom],
  );
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [batchDone, setBatchDone] = useState(false);
  /**
   * U02: the new names for the files as they are now, the folder they came
   * from, if any, and what was renamed in it. Its checks, folder picker and
   * renames in place load with the tools that rename (`names`).
   */
  const [renaming, setRenaming] = useState<typeof FolderRename | null>(null);
  const [namesPlan, setNamesPlan] = useState<NamesPlan | null>(null);
  const [folder, setFolder] = useState<FolderRename.Folder | null>(null);
  const [renamed, setRenamed] = useState<Renamed[] | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const planRound = useRef(0);
  useEffect(() => {
    if (!preset.names) return;
    let live = true;
    void import('./FolderRename').then((loaded) => {
      // A transition, so settings the server rendered (the checklist) stay on
      // screen until their own code has loaded.
      if (live)
        startTransition(() => {
          setRenaming(loaded);
        });
    });
    return () => {
      live = false;
    };
  }, [preset.names]);
  const folderable = Boolean(preset.names?.inPlace && renaming?.canRenameInPlace());
  const batchOutputs = useRef(new Map<string, { blob: Blob; name: string }>());
  /** U04: a batch that starts as soon as its files arrive (`preset.autoRun`). */
  const autoBatch = useRef(false);
  const [sheet, setSheet] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);
  // Canvas editor tools: the edit (crop box, turns) the engine applies.
  const ratioOf = preset.editor?.ratio;
  const ratio = ratioOf?.(options) ?? null;
  const editor = useEditor(ratio);
  const resetEditor = editor.reset;
  // A mask brush (P17) takes the canvas instead of the crop and turn editor.
  const editing = tool.ui === 'canvas-editor' && !preset.editor?.compare && !preset.mask;
  const cropping = editing && (preset.editor?.modes?.includes('crop') ?? true);
  const [cropSheet, setCropSheet] = useState(false);
  // P07: the Refine brush over the result.
  const [refining, setRefining] = useState(false);
  // Media tools: what the probe found, and the timeline's frames.
  const [media, setMedia] = useState<ProbeInfo | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [peaks, setPeaks] = useState<number[]>([]);
  // Two columns or one (the server renders two; phones switch after loading).
  const wide = useSyncExternalStore(
    subscribeWide,
    () => matchMedia(WIDE).matches,
    () => true,
  );

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

  // A result's file is let go once it's no longer shown: a new result
  // replaced it (a LUT slider redoes it at every step), the run failed, or
  // Start over. A second's grace lets a download just started from it finish
  // reading it. "Use in another tool" hands over the blob, not the URL.
  const resultUrl = state.kind === 'result' ? state.output.url : undefined;
  useEffect(() => {
    const owned = urls.current;
    if (!resultUrl || !owned.includes(resultUrl)) return;
    return () => {
      owned.splice(owned.indexOf(resultUrl), 1);
      setTimeout(() => {
        URL.revokeObjectURL(resultUrl);
      }, RESULT_GRACE_MS);
    };
  }, [resultUrl]);

  const run = useCallback(
    async (input: InputInfo, file: File, values: Record<string, string> = options) => {
      if (!engine) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const started = performance.now();
      track('tool_run_started', { path: 'client' });
      setOnServer(false);
      setState({ kind: 'running', input, fraction: 0, elapsedSec: 0 });
      try {
        const edit = editor.edit;
        const out = await engine.run(
          file,
          {
            ...engineOptions,
            ...values,
            ...(editing && {
              // Tools without a crop mode (P04) don't crop to the box the editor keeps.
              crop: cropping ? (edit.crop ?? undefined) : undefined,
              turns: edit.turns,
              flip: edit.flip,
              flipV: edit.flipV,
              angle: edit.angle,
              ...(!isNeutral(edit.adjust) && { adjust: edit.adjust }),
              ...(edit.redact && activeAreas(edit.redact).length > 0 && { redact: edit.redact }),
              ...(edit.marks && edit.marks.length > 0 && { marks: edit.marks }),
              ...(edit.texts &&
                edit.texts.length > 0 &&
                editor.natural && { texts: edit.texts, natural: editor.natural }),
            }),
            ...(preset.combine && { files: queue.map((q) => q.file) }),
            ...(tool.ui === 'timeline' && {
              start: range.start,
              end: range.end,
              ...(preset.ranges && { ranges }),
            }),
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
          out.report ??
          (preset.preview === 'text'
            ? (await out.blob.text()).slice(0, TEXT_PREVIEW_CHARS)
            : undefined);
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
            suffix: out.nameSuffix,
            ...(out.name && { name: out.name }),
            url,
            blob: out.blob,
            seconds,
            path: out.path,
            width: out.width ?? input.width,
            height: out.height ?? input.height,
            notes: out.notes,
            details: out.details,
            swatches: out.swatches,
            graph: out.graph,
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
          retry: server ? { input, file } : undefined,
        });
      }
    },
    [
      cropping,
      editing,
      editor.edit,
      editor.natural,
      engine,
      engineOptions,
      options,
      preset,
      queue,
      range,
      ranges,
      server,
      tool.ui,
      track,
    ],
  );

  /**
   * The same file on our servers, once the person has pressed the button that
   * says so: upload, the server's price (asked again if it differs), the job's
   * progress, and the result downloaded back like a browser result.
   */
  const runOnServer = useCallback(
    async (input: InputInfo, file: File) => {
      if (!server) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const started = performance.now();
      track('tool_run_started', { path: 'server' });
      setOnServer(true);
      setState({ kind: 'running', input, stage: 'Uploading', fraction: 0, elapsedSec: 0 });
      try {
        const credits = server.estimate(
          joined ? joined.durationSec : (media?.durationSec ?? input.durationSec),
          { width: media?.width ?? input.width, height: media?.height ?? input.height },
          options,
        );
        const free =
          credits === 0 || (account !== null && account !== undefined && account.freeJobsLeft > 0);
        const out = await server.run(file, options, {
          signal: abort.signal,
          ...(joined && { files: joined.files }),
          offered: { credits, free },
          progress: ({ stage, fraction, amount, step }) => {
            setState({
              kind: 'running',
              input,
              stage,
              fraction,
              amount,
              step,
              elapsedSec: (performance.now() - started) / 1000,
            });
          },
          confirm: (quote) =>
            new Promise<boolean>((resolve) => {
              setAsking({
                quote,
                answer: (go) => {
                  setAsking(null);
                  if (!go) {
                    // Declined: nothing runs, and the upload goes (the run sees the abort).
                    abort.abort();
                    setState({ kind: 'ready', input, files: [file] });
                  }
                  resolve(go);
                },
              });
            }),
        });
        const url = URL.createObjectURL(out.blob);
        urls.current.push(url);
        // Text results (subtitles, transcripts) show their start, as browser ones do.
        const text =
          preset.preview === 'text'
            ? (await out.blob.text()).slice(0, TEXT_PREVIEW_CHARS)
            : undefined;
        const seconds = (performance.now() - started) / 1000;
        track('tool_run_succeeded', {
          engine_path: 'server',
          duration: durationBucket(seconds * 1000),
        });
        // The balance and free jobs left have changed.
        setAccount(undefined);
        setServerReason(null);
        setState({
          kind: 'result',
          input,
          file,
          output: {
            size: out.blob.size,
            ext: out.ext,
            url,
            blob: out.blob,
            seconds,
            path: 'server',
            width: out.width ?? input.width,
            height: out.height ?? input.height,
            notes: out.notes,
            text,
          },
        });
      } catch (error) {
        if (abort.signal.aborted) return;
        track('tool_run_failed', { error_code: 'server', engine_path: 'server' });
        setAccount(undefined);
        const known = serverPath && error instanceof serverPath.ServerRunError ? error : null;
        const message = (error instanceof Error ? error.message : 'Unknown error').replace(
          /\.$/,
          '',
        );
        const buyHref = known?.needsCredits ? account?.buyHref : null;
        setState({
          kind: 'error',
          label: "Couldn't process this file",
          title: known?.title ?? 'Our servers couldn’t do this',
          body: `${message}.${known?.creditsReturned ? ' Credits returned.' : ''}`,
          ...(buyHref && { buyHref }),
        });
      }
    },
    [account, joined, media, options, preset.preview, server, serverPath, track],
  );

  /** The free preview: the page cuts and sends the snippet; the result plays A/B. */
  const runPreview = useCallback(
    async (file: File) => {
      if (!server?.preview) return;
      previewAbort.current?.abort();
      const abort = new AbortController();
      previewAbort.current = abort;
      const started = performance.now();
      const made = JSON.stringify(options);
      setSnippet({ kind: 'running', stage: 'Cutting the preview', elapsedSec: 0 });
      try {
        const result = await server.preview.run(file, options, {
          signal: abort.signal,
          offered: { credits: 0, free: true },
          progress: ({ stage, fraction, amount }) => {
            setSnippet({
              kind: 'running',
              stage,
              fraction,
              amount,
              elapsedSec: (performance.now() - started) / 1000,
            });
          },
          // A preview is free; a price would mean something else is wrong.
          confirm: () => Promise.resolve(false),
        });
        setSnippet({ kind: 'done', result, options: made, at: performance.now() });
      } catch (error) {
        setSnippet(
          abort.signal.aborted
            ? { kind: 'idle' }
            : {
                kind: 'error',
                message: `${(error instanceof Error ? error.message : 'Unknown error').replace(/\.$/, '')}.`,
              },
        );
      } finally {
        // Free jobs left have changed.
        if (!abort.signal.aborted) setAccount(undefined);
      }
    },
    [options, server],
  );

  const dropPreview = useCallback(() => {
    previewAbort.current?.abort();
    previewAbort.current = null;
    setSnippet({ kind: 'idle' });
  }, []);

  // Why the server is offered: the person chose it, or the files to join are too big together.
  const offerReason = serverReason ?? joined?.reason ?? null;

  // The account decides the offer's terms: loaded when the offer shows.
  useEffect(() => {
    if (!server || offerReason === null || account !== undefined) return;
    let live = true;
    server
      .account()
      .then((found) => {
        if (live) setAccount(found);
      })
      .catch(() => {
        if (live) setAccount(null);
      });
    return () => {
      live = false;
    };
  }, [account, server, offerReason]);

  /** Media tools read the file first: its length sets up the timeline. */
  const inspect = useCallback(
    async (input: InputInfo, file: File, files: File[], offer: string | null) => {
      if (!preset.probe) return;
      setMedia(null);
      setThumbs([]);
      setPeaks([]);
      setState({ kind: 'running', input, stage: 'Reading the file', elapsedSec: 0 });
      let info: ProbeInfo;
      try {
        info = await preset.probe(file);
      } catch (error) {
        if (server) {
          // Our servers read more than any browser: offer them instead of a dead end.
          setServerReason(
            offer ??
              `Your browser can’t read this file (${error instanceof Error ? error.message.replace(/\.$/, '') : 'unknown format'}). Our servers can try.`,
          );
          setState({ kind: 'ready', input, files });
          return;
        }
        setState({
          kind: 'error',
          label: "Couldn't read this file",
          title: 'This file won’t work here',
          body: error instanceof Error ? error.message : 'It couldn’t be read.',
        });
        return;
      }
      setMedia(info);
      // A choice made while the file was being read stands (A13: Split picked before the check ends).
      const suggested = info.values
        ? Object.fromEntries(Object.entries(info.values).filter(([id]) => !touched.current.has(id)))
        : undefined;
      if (suggested) setOptions((current) => ({ ...current, ...suggested }));
      // A search a setting change was about to start would read the file before this one.
      if (detectTimer.current) clearTimeout(detectTimer.current);
      setTimeline((current) => ({
        ranges: [preset.initialRange?.(info.durationSec) ?? { start: 0, end: info.durationSec }],
        active: 0,
        found: current.found + 1,
      }));
      if (preset.detect) void detectRanges(file, { ...options, ...suggested });
      const probed = { ...input, durationSec: info.durationSec };
      setServerReason(offer);
      setState({ kind: 'ready', input: probed, files });
      // Tools that run as a file arrives (A03) run once it's read.
      if (preset.autoRun && !offer) void run(probed, file);
      void info
        .thumbnails?.(12)
        .then((frames) => {
          urls.current.push(...frames.filter(Boolean));
          setThumbs(frames);
        })
        .catch(() => undefined);
      void info
        .waveform?.(160)
        .then(setPeaks)
        .catch(() => undefined);
    },
    [preset, run, server, options, detectRanges],
  );

  const intake = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      touched.current.clear();
      resetEditor();
      setRefining(false);
      setNamesPlan(null);
      setFolder(null);
      setRenamed(null);
      setRenameError(null);
      // Refine strokes and a focal point belong to the last image.
      const refineId = preset.editor?.refine;
      if (refineId) setOptions((current) => ({ ...current, [refineId]: '' }));
      const focusId = preset.focus?.option;
      if (focusId) setOptions((current) => ({ ...current, [focusId]: '' }));
      const maskId = preset.mask?.option;
      if (maskId) setOptions((current) => ({ ...current, [maskId]: '' }));
      if (preset.maxFiles && files.length > preset.maxFiles) {
        setState({
          kind: 'error',
          label: 'Too many files',
          title: `Up to ${String(preset.maxFiles)} files at once`,
          body: `You added ${String(files.length)}. Choose ${String(preset.maxFiles)} or fewer and try again.`,
        });
        return;
      }
      dropPreview();
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      const input: InputInfo = { name: file.name, size: file.size, url };
      // A server tool always runs there; a hybrid one when the file is bigger
      // than the browser takes (the drop zone let it in for the server).
      const offer = !server
        ? null
        : !engine
          ? (preset.serverReason ?? 'This tool runs on our servers.')
          : file.size > preset.maxBytes
            ? `This is a ${formatBytes(file.size)} file; the browser limit for this tool is ${formatBytes(preset.maxBytes)}. Our servers can take it.`
            : null;
      setServerReason(null);
      track('tool_file_added', {
        mime: file.type.split('/')[0] || 'unknown',
        size: sizeBucket(file.size),
      });
      // Several files into one (A04, V12): listed in order, joined on run.
      if (preset.combine) {
        addToQueue(files);
        setServerReason(null);
        setState({ kind: 'ready', input, files });
        return;
      }
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
        autoBatch.current = preset.autoRun === true;
        setState({ kind: 'ready', input, files });
        return;
      }
      if (preset.probe) {
        void inspect(input, file, files, offer);
        return;
      }
      setServerReason(offer);
      if (preset.autoRun && !offer) void run(input, file);
      else setState({ kind: 'ready', input, files });
    },
    [addToQueue, dropPreview, engine, inspect, preset, resetEditor, run, server, tool.ui, track],
  );

  // A result handed over from another tool arrives as if it were dropped here.
  const handedOver = useRef(false);
  useEffect(() => {
    if (handedOver.current) return;
    handedOver.current = true;
    const files = takeHandoff(tool.id);
    // Arrives like a drop: an event from outside the render, not derived state.
    if (files)
      queueMicrotask(() => {
        intake(files);
      });
  }, [intake, tool.id]);

  async function trySample() {
    if (!preset.sampleUrl) return;
    const response = await fetch(preset.sampleUrl);
    const blob = await response.blob();
    intake([new File([blob], preset.sampleName ?? 'sample', { type: blob.type })]);
  }

  async function runBatch(files: File[]) {
    if (!engine) return;
    const abort = new AbortController();
    controller.current = abort;
    track('tool_run_started', { path: 'client', files: String(files.length) });
    // Rows' changes are gathered and drawn every BATCH_DRAW_MS, not with one
    // render of the whole shell for each: a render takes about as long as a
    // small file, so 50 of them took several times the work itself.
    const pending = new Map<number, Partial<BatchItem>>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (abort.signal.aborted || controller.current !== abort) pending.clear();
      if (pending.size === 0) return;
      const patches = new Map(pending);
      pending.clear();
      setBatch((items) =>
        items.map((item, i) => {
          const patch = patches.get(i);
          return patch ? { ...item, ...patch } : item;
        }),
      );
    };
    for (const [index, file] of files.entries()) {
      const id = batch[index]?.id ?? String(index);
      const update = (patch: Partial<BatchItem>) => {
        pending.set(index, { ...pending.get(index), ...patch });
        timer ??= setTimeout(flush, BATCH_DRAW_MS);
      };
      update({ status: 'running', progress: 0 });
      try {
        const out = await engine.run(
          file,
          { ...engineOptions, ...options },
          {
            signal: abort.signal,
            batch: { index, files },
            progress: (fraction) => {
              update({ progress: fraction });
            },
          },
        );
        batchOutputs.current.set(id, {
          blob: out.blob,
          name: out.name ?? outputName(file.name, out.nameSuffix ?? preset.outputSuffix, out.ext),
        });
        update({
          status: 'done',
          resultSize: out.blob.size,
          note: out.notes?.join('. '),
          ...(out.details && {
            facts: out.details.map(({ label, value }) => ({ label, value })),
          }),
        });
      } catch (error) {
        if (abort.signal.aborted) {
          flush();
          return;
        }
        update({
          status: 'failed',
          error: error instanceof Error ? error.message : "Couldn't read this file.",
        });
      }
    }
    // The last rows land with "done", in one render.
    flush();
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
    // Renamed files (U02) are stored as they are: squeezing photos and clips again only takes time.
    const zip = zipSync(entries, preset.names ? { level: 0 } : {});
    saveBlob(new Blob([zip], { type: 'application/zip' }), `${tool.id}.zip`);
    track('tool_download', { files: String(batchOutputs.current.size) });
  }, [preset.names, saveBlob, tool.id, track]);

  // A batch that runs on arrival starts once its list is in place, so each file's row is known.
  useEffect(() => {
    if (!autoBatch.current || state.kind !== 'ready' || !state.files || batch.length === 0) return;
    autoBatch.current = false;
    void runBatch(state.files);
  });

  /** U04: the finished files' values, for checks, the summary and the list. */
  const batchResults: BatchResult[] = batch
    .filter((item) => item.status === 'done' && item.facts)
    .map((item) => ({ name: item.name, size: item.size, facts: item.facts ?? [] }));

  const downloadList = useCallback(() => {
    if (!preset.batchList) return;
    const list = preset.batchList.make(batchResults, options);
    // A name with no extension (SHA256SUMS) goes as plain bytes: as text/plain, Chrome adds ".txt".
    const type = list.name.endsWith('.csv')
      ? 'text/csv'
      : list.name.includes('.')
        ? 'text/plain'
        : 'application/octet-stream';
    saveBlob(new Blob([list.text], { type }), list.name);
    track('tool_download', { files: String(batchResults.length) });
  }, [batchResults, options, preset.batchList, saveBlob, track]);

  // U02: the files are named again whenever they or the settings change; the newest answer wins.
  const namer = preset.names;
  const planFiles = state.kind === 'ready' ? state.files : undefined;
  useEffect(() => {
    if (!namer || !planFiles || renamed) return;
    const round = (planRound.current += 1);
    const timer = setTimeout(() => {
      void namer.plan(planFiles, options).then(
        (plan) => {
          if (round === planRound.current) setNamesPlan(plan);
        },
        () => undefined,
      );
    }, 120);
    return () => {
      clearTimeout(timer);
    };
  }, [namer, planFiles, options, renamed]);

  /** U02: a folder's files, to rename where they are. */
  const openFolder = useCallback(() => {
    void renaming?.openFolder(
      (files, opened) => {
        intake(files);
        setFolder(opened);
      },
      (error) => {
        setState({ kind: 'error', ...error });
      },
    );
  }, [intake, renaming]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    dropPreview();
    setServerReason(null);
    setState({ kind: 'empty' });
    setBatch([]);
    setQueue([]);
    setBatchDone(false);
    batchOutputs.current.clear();
    setNamesPlan(null);
    setFolder(null);
    setRenamed(null);
    setRenameError(null);
    resetEditor();
    setMedia(null);
    setThumbs([]);
    setPeaks([]);
  }, [dropPreview, resetEditor]);

  const removeQueued = useCallback(
    (index: number) => {
      if (queue.length <= 1) {
        cancel();
        return;
      }
      setQueue((current) => current.filter((_, i) => i !== index));
    },
    [cancel, queue.length],
  );

  /**
   * Sets an option; a new crop ratio refits the editor's box. Tools that run
   * as a file arrives run again with it (P07: a new background reuses the mask).
   */
  const changeOption = (id: string, value: string) => {
    touched.current.add(id);
    const next = { ...options, [id]: value };
    setOptions(next);
    if (ratioOf) editor.applyRatio(ratioOf(next));
    // A11: what's found depends on these options; look again once typing stops.
    const readyFile = state.kind === 'ready' ? state.files?.[0] : undefined;
    if (preset.detect?.deps.includes(id) && readyFile) {
      if (detectTimer.current) clearTimeout(detectTimer.current);
      // A search for the old settings still running is void now: its parts
      // must not land, nor its end let the run go before these are found.
      detectRound.current += 1;
      setDetecting(true);
      detectTimer.current = setTimeout(() => {
        void detectRanges(readyFile, next);
      }, 300);
    }
    if (preset.autoRun && state.kind === 'result' && state.file) {
      void run(state.input, state.file, next);
    }
    if (preset.rerun && state.kind === 'result' && state.file && !preset.blocked?.(next, 1)) {
      const { input, file } = state;
      if (rerunTimer.current) clearTimeout(rerunTimer.current);
      rerunTimer.current = setTimeout(() => {
        void run(input, file, next);
      }, 250);
    }
  };

  const download = useCallback(() => {
    if (state.kind !== 'result' || !state.output.url) return;
    const a = document.createElement('a');
    a.href = state.output.url;
    a.download =
      state.output.name ??
      outputName(state.input.name, state.output.suffix ?? preset.outputSuffix, state.output.ext);
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
      {tool.desktopBest && (
        <p className="mt-2 flex items-center gap-2 px-4 text-14 text-text-muted lg:hidden">
          <Monitor size={16} strokeWidth={1.75} aria-hidden="true" className="flex-none" />
          Works best on a computer, and works here too.
        </p>
      )}
    </div>
  );

  const fileCount = batch.length || (state.kind === 'ready' ? (state.files?.length ?? 1) : 1);
  // Probed options take their choices from the file and hide when there is nothing to pick.
  const visibleOptions = preset.options
    .map((option) =>
      option.probed ? { ...option, choices: media?.choices?.[option.id] ?? [] } : option,
    )
    .filter(
      (option) =>
        optionVisible(option, options) &&
        (!option.probed || (option.choices?.length ?? 0) > 1) &&
        (!option.files || option.files === (fileCount > 1 ? 'many' : 'one')),
    );
  const showCrop = cropping && state.kind === 'ready' && batch.length === 0;
  // An analyzer changes nothing: its notes are the verdict.
  const notesTitle = tool.ui === 'analyzer' ? 'Verdict' : undefined;
  // A server tool on a copy of the site with no server path (the static export) can't run.
  const blocked =
    state.kind !== 'ready'
      ? undefined
      : !engine && !server
        ? 'This tool runs on our servers, and this copy of the site doesn’t connect to them.'
        : preset.combine && queue.length < preset.combine.min
          ? `Add at least ${String(preset.combine.min)} files.`
          : preset.combine && queue.some((q) => q.error)
            ? `Remove ${queue.find((q) => q.error)?.name ?? 'the file'}: ${queue.find((q) => q.error)?.error ?? 'it can’t be read here.'}`
            : preset.detect && detecting
              ? preset.detect.busy
              : preset.detect && ranges.length === 0
                ? preset.detect.empty
                : preset.names && !renamed
                  ? renaming
                    ? renaming.namesBlocked(
                        namesPlan,
                        // Files dropped, not a folder opened, download renamed in a ZIP.
                        folder
                          ? undefined
                          : {
                              bytes: (state.files ?? []).reduce((sum, f) => sum + f.size, 0),
                              maxBytes: preset.names.zipMaxBytes,
                              inPlace: folderable,
                            },
                      )
                    : 'Reading the files…'
                  : preset.blocked?.(options, state.files?.length ?? 1);
  const settings = (
    <OptionsPanel className="mt-6.5 hidden lg:block">
      {visibleOptions.map((option) => (
        <OptionLine key={option.id} option={option}>
          <OptionControl
            option={option}
            value={options[option.id] ?? option.default}
            onChange={(value) => {
              changeOption(option.id, value);
            }}
          />
        </OptionLine>
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

  // The offer's numbers: the price for this file's length (or the files to join), and whether this account can start it.
  const serverCredits =
    server && state.kind === 'ready'
      ? server.estimate(
          joined ? joined.durationSec : (media?.durationSec ?? state.input.durationSec),
          {
            width: media?.width ?? state.input.width,
            height: media?.height ?? state.input.height,
          },
          options,
        )
      : null;
  // What a run sends: the file, or less (a video sends only its sound), or the files to join.
  const sendFile = state.kind === 'ready' ? state.files?.[0] : undefined;
  const sendBytes = joined
    ? joined.bytes
    : state.kind === 'ready'
      ? sendFile && server?.uploadBytes
        ? server.uploadBytes(sendFile)
        : state.input.size
      : 0;
  const serverOffer =
    server && offerReason !== null && state.kind === 'ready'
      ? {
          ok:
            account && serverPath
              ? serverPath.serverTerms(server, account, sendBytes, serverCredits).ok
              : false,
          notice: (className: string) =>
            serverPath && (
              <serverPath.ServerNotice
                server={server}
                reason={offerReason}
                account={account}
                bytes={sendBytes}
                credits={serverCredits}
                className={className}
              />
            ),
        }
      : null;
  // The free preview's button and terms, beside the offer.
  const previewOffer = server?.preview;
  const previewLine = account && serverPath ? serverPath.previewTerms(account) : null;
  const previewControl =
    previewOffer && serverOffer && state.kind === 'ready' && batch.length === 0
      ? (className: string) => (
          <div className={className}>
            {snippet.kind === 'running' ? (
              <Button size="md" onClick={dropPreview}>
                Cancel the preview
              </Button>
            ) : (
              <Button
                size="md"
                disabled={!previewLine?.ok || Boolean(blocked)}
                onClick={() => {
                  if (sendFile) void runPreview(sendFile);
                }}
              >
                {snippet.kind === 'done' ? 'Preview again' : 'Preview'}{' '}
                {String(previewOffer.seconds)} s · free
              </Button>
            )}
            <p className="mt-2 text-13.5 leading-body text-text-muted">
              {previewLine?.line ??
                `Hear ${String(previewOffer.seconds)} s cleaned before you run the whole file.`}
            </p>
            {snippet.kind === 'error' && (
              <p role="alert" className="mt-2 flex items-baseline gap-2 text-14 leading-body">
                <span aria-hidden="true" className="size-2 flex-none rounded-full bg-danger" />
                {snippet.message}
              </p>
            )}
          </div>
        )
      : null;
  // Within the browser's limits the server is a choice, never a push.
  const serverChoice = server &&
    offerReason === null &&
    state.kind === 'ready' &&
    batch.length === 0 && (
      <p className="mt-3.5 px-4 text-14 lg:px-0">
        <button
          type="button"
          className="link-accent"
          onClick={() => {
            setServerReason('You chose our servers: handy for long videos or a slow device.');
          }}
        >
          Use our servers instead
        </button>
      </p>
    );

  const inBatch = batch.length > 0;
  const batchRunning = inBatch && !batchDone && batch.some((item) => item.status !== 'queued');
  const running = state.kind === 'running' || batchRunning;
  const result = state.kind === 'result';
  const actions = hasFile && (
    <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2.5 border-t border-border bg-bg px-4 pt-3 pb-6.5 lg:static lg:mt-6.5 lg:gap-3 lg:border-0 lg:bg-transparent lg:p-0">
      {inBatch && folder && renaming ? (
        <renaming.FolderAction
          folder={folder}
          plan={namesPlan}
          renamed={renamed}
          disabled={batchRunning || Boolean(blocked)}
          runLabel={preset.runLabel}
          host={{ setBatch, setBatchDone, setRenamed, setError: setRenameError, track }}
        />
      ) : inBatch ? (
        batchDone ? (
          preset.batchList ? (
            <Button
              variant="primary"
              className="flex-1"
              disabled={batchResults.length === 0}
              onClick={downloadList}
              icon={<Download aria-hidden="true" size={18} strokeWidth={2} />}
            >
              {preset.batchList.label(options)}
            </Button>
          ) : (
            <Button
              variant="primary"
              className="flex-1"
              disabled={batch.every((item) => item.status !== 'done')}
              onClick={() => void downloadAll()}
              icon={<Download aria-hidden="true" size={18} strokeWidth={2} />}
            >
              Download all · ZIP
            </Button>
          )
        ) : (
          <Button
            variant="primary"
            className="flex-1"
            disabled={batchRunning || Boolean(blocked)}
            onClick={() => {
              if (state.kind === 'ready' && state.files) void runBatch(state.files);
            }}
          >
            {preset.runLabel ?? 'Start'} · {plural(batch.length, 'file')}
          </Button>
        )
      ) : state.kind === 'ready' && serverOffer ? (
        <Button
          variant="primary"
          className="flex-1"
          disabled={Boolean(blocked) || !serverOffer.ok}
          onClick={() => {
            if (state.files?.[0]) void runOnServer(state.input, state.files[0]);
          }}
        >
          {preset.runLabel ?? 'Start'} on our servers
        </Button>
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

  // Back to the image to change the crop (editors), the sizes and focal point (P13) or the mask
  // (P17), then run again.
  const back = state.kind === 'result' &&
    (editing || preset.focus || preset.mask) &&
    state.file && (
      <p className="mt-3.5 px-4 text-14 lg:px-0">
        <button
          type="button"
          className="link-accent"
          onClick={() => {
            if (state.file) setState({ kind: 'ready', input: state.input, files: [state.file] });
          }}
        >
          {editing
            ? 'Back to the editor'
            : preset.mask
              ? 'Back to the brush'
              : 'Back to the settings'}
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
            // The result goes along when the next tool takes its type (docs/02 → Result panel).
            const blob = state.output.blob;
            const name =
              state.output.name ??
              outputName(
                state.input.name,
                state.output.suffix ?? preset.outputSuffix,
                state.output.ext,
              );
            if (blob && link.id && accepts(link.accepts, { type: blob.type, name })) {
              handOff(new File([blob], name, { type: blob.type }), link.id);
            }
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
      multiRange={preset.ranges ? { ranges, active: activeRange, onChange: changeRanges } : null}
      batch={
        namesPlan
          ? batch.map((item, i) => {
              const named = namesPlan.names[i];
              return named ? { ...item, ...named } : item;
            })
          : preset.batchCheck
            ? batch.map((item) => {
                if (item.status !== 'done' || !item.facts) return item;
                const verdict = preset.batchCheck?.(
                  { name: item.name, size: item.size, facts: item.facts },
                  options,
                );
                return verdict
                  ? { ...item, note: verdict.note ?? item.note, problem: verdict.problem }
                  : item;
              })
            : batch
      }
      batchSummary={batchDone ? (preset.batchSummary?.(batchResults, options) ?? null) : null}
      onDownloadItem={folder || preset.batchList ? undefined : downloadItem}
      combine={
        preset.combine
          ? {
              items: queue,
              onMove: moveQueued,
              onRemove: removeQueued,
              onAdd: addToQueue,
              accept: preset.accept,
              max: preset.combine.max,
            }
          : null
      }
      editor={editor}
      ratio={ratio}
      media={media}
      thumbs={thumbs}
      peaks={peaks}
      subtitles={
        preset.subtitles
          ? {
              cues: options[preset.subtitles.cues],
              media: fileOptionFile(options[preset.subtitles.media] ?? ''),
              rules: preset.subtitles.rules(options),
              onChange: (json) => {
                if (preset.subtitles) changeOption(preset.subtitles.cues, json);
              },
            }
          : null
      }
      preview={
        previewOffer
          ? {
              state: snippet,
              changed: snippet.kind === 'done' && snippet.options !== JSON.stringify(options),
            }
          : null
      }
      picker={
        preset.picker
          ? {
              sample: Number(options[preset.picker.sample]) || 1,
              zoom: Number(options[preset.picker.zoom]) || 8,
              history: options[preset.picker.history],
              onPick: (hexes) => {
                if (preset.picker) changeOption(preset.picker.history, JSON.stringify(hexes));
              },
            }
          : null
      }
      focus={
        preset.focus && (preset.focus.when?.(options) ?? true)
          ? {
              value: options[preset.focus.option],
              frames: preset.focus.frames(options),
              onChange: (value) => {
                if (preset.focus) changeOption(preset.focus.option, value);
              },
            }
          : null
      }
      mask={
        preset.mask
          ? {
              strokes: parseStrokes(options[preset.mask.option], MASK_MODES),
              onChange: (strokes) => {
                if (preset.mask)
                  changeOption(preset.mask.option, strokes.length ? JSON.stringify(strokes) : '');
              },
            }
          : null
      }
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
          <>
            {state.retry && (
              <Button
                variant="primary"
                onClick={() => {
                  const retry = state.retry;
                  if (!retry) return;
                  setServerReason('Your browser couldn’t do this one. Our servers can try.');
                  setState({ kind: 'ready', input: retry.input, files: [retry.file] });
                }}
              >
                Use our servers
              </Button>
            )}
            {state.buyHref && (
              <ButtonLink href={state.buyHref} variant="primary">
                Buy credits
              </ButtonLink>
            )}
            <Button
              variant={state.retry || state.buyHref ? 'secondary' : 'primary'}
              onClick={cancel}
            >
              Try another file
            </Button>
          </>
        }
      />
    </div>
  ) : (
    <DropZone
      accept={preset.accept}
      multiple={preset.multiple ?? Boolean(preset.combine)}
      // With a server path, bigger files come in and get the server offer.
      maxBytes={server ? Math.max(preset.maxBytes, server.maxBytes.paid) : preset.maxBytes}
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
      folder={folderable && renaming && <renaming.OpenFolderButton onClick={openFolder} />}
      active
    />
  );

  // A03's tap tempo and metronome sit under the settings; on a phone with a
  // file in, the settings column is empty and comes first, so they move under
  // the result instead. Only after a file arrives, so the server's HTML (no
  // file) is the same on every screen.
  const tempoTools = preset.tempo ? (
    <div className="mt-10 px-4 pb-6 lg:px-0">{preset.tempo}</div>
  ) : null;

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
        {serverOffer?.notice('mt-6.5 hidden lg:block')}
        {actions}
        {previewControl?.('mt-5 hidden lg:block')}
        {serverChoice}
        {blocked && (
          <p role="status" className="mt-3.5 px-4 text-14 leading-body text-text-muted lg:px-0">
            {blocked}
          </p>
        )}
        {renaming && <renaming.RenameNotes error={renameError} renamed={renamed} folder={folder} />}
        {state.kind === 'ready' && media?.warnings && media.warnings.length > 0 && (
          <Notes title="Before you start" notes={media.warnings} className="mt-6 px-4 lg:px-0" />
        )}
        {running && (onServer || preset.runningNote) && (
          <p className="mt-3.5 hidden text-14 leading-body text-text-muted lg:block">
            {onServer
              ? 'It runs on our servers; keep this tab open to get the result back.'
              : preset.runningNote}
          </p>
        )}
        {result && state.output.notes && state.output.notes.length > 0 && (
          <Notes notes={state.output.notes} title={notesTitle} className="mt-6 hidden lg:block" />
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
        {preset.tempo && (!hasFile || wide) && tempoTools}
      </section>

      <section
        aria-label="Workspace"
        className={cn('relative lg:min-h-0', hasFile ? 'max-lg:order-1' : 'max-lg:pb-8')}
      >
        {preview}
      </section>

      {asking && serverPath && (
        <serverPath.PriceDialog quote={asking.quote} answer={asking.answer} />
      )}

      {/* Phone result: title, settings as tappable rows, handoff links. */}
      {hasFile && (
        <div className="pb-28 lg:hidden">
          {serverOffer?.notice('mx-4 mt-4')}
          {previewControl?.('mx-4 mt-4')}
          {result && (
            <h2 className="px-4 pt-4 text-24 leading-title font-display tracking-title">
              {preset.resultTitle}
            </h2>
          )}
          {result && state.output.notes && state.output.notes.length > 0 && (
            <Notes notes={state.output.notes} title={notesTitle} className="mx-4 mt-4" />
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
                <OptionLine key={option.id} option={option}>
                  <OptionControl
                    option={option}
                    value={options[option.id] ?? option.default}
                    onChange={(value) => {
                      changeOption(option.id, value);
                    }}
                  />
                </OptionLine>
              );
            })}
          </Dialog>
          {preset.tempo && !wide && tempoTools}
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
  multiRange,
  batch,
  batchSummary,
  onDownloadItem,
  combine,
  editor,
  ratio,
  media,
  thumbs,
  peaks,
  preview,
  picker,
  subtitles,
  focus,
  mask,
  refine,
}: {
  state: ShellState;
  tool: ShellTool;
  preset: ShellPreset;
  range: TimelineRange;
  setRange: (range: TimelineRange) => void;
  multiRange: MultiRange | null;
  batch: BatchItem[];
  /** U04: a line over the list, from the results ("The 2 files are identical"). */
  batchSummary: string | null;
  onDownloadItem?: (id: string) => void;
  combine: {
    items: OrderedFile[];
    onMove: (from: number, to: number) => void;
    onRemove: (index: number) => void;
    onAdd: (files: File[]) => void;
    accept: string;
    max: number;
  } | null;
  editor: EditorState;
  ratio: number | null;
  media: ProbeInfo | null;
  thumbs: string[];
  peaks: number[];
  /** A server tool's free preview: its progress, or the A/B player once it's back. */
  preview: { state: PreviewState; changed: boolean } | null;
  picker: {
    sample: number;
    zoom: number;
    history: string | undefined;
    onPick: (hexes: string[]) => void;
  } | null;
  /** T03: the cues as the option's JSON; the editor parses them. */
  subtitles: {
    cues: string | undefined;
    media: File | undefined;
    rules: CheckRules;
    onChange: (json: string) => void;
  } | null;
  focus: {
    value: string | undefined;
    frames: FocusFrame[];
    onChange: (value: string) => void;
  } | null;
  mask: { strokes: MaskStroke[]; onChange: (strokes: MaskStroke[]) => void } | null;
  refine: {
    strokes: BrushStroke[];
    apply: (strokes: BrushStroke[]) => void;
    cancel: () => void;
  } | null;
}) {
  if (state.kind !== 'running' && state.kind !== 'result' && state.kind !== 'ready') return null;
  // P01's editor carries a mode bar and a tool bar on phones: it gets most of the screen.
  const frame = cn(
    'relative overflow-hidden lg:absolute lg:inset-0 lg:h-auto',
    preset.editor?.layout === 'rail' ? 'h-[max(24.5rem,72dvh)]' : 'h-98',
  );

  if (picker && state.input.url) {
    return (
      <Suspense fallback={null}>
        <ColorPicker src={state.input.url} {...picker} />
      </Suspense>
    );
  }

  if (subtitles) {
    return (
      <Suspense fallback={null}>
        <SubtitleWorkspace {...subtitles} />
      </Suspense>
    );
  }

  if (combine && state.kind === 'ready') {
    return (
      <div className="px-4 py-6 lg:px-10 lg:pt-8.5">
        <Suspense fallback={null}>
          <FileOrder {...combine} />
        </Suspense>
      </div>
    );
  }

  if (tool.ui === 'batch' || batch.length > 0) {
    return (
      <div className="px-4 py-6 lg:px-10 lg:pt-8.5">
        {batchSummary && (
          <p role="status" className="mb-4 text-15 font-strong">
            {batchSummary}
          </p>
        )}
        <Suspense fallback={null}>
          <BatchList items={batch} onDownload={onDownloadItem} results={!preset.batchList} />
        </Suspense>
      </div>
    );
  }

  if (focus && state.kind === 'ready' && state.input.url) {
    return (
      <div className="px-4 py-6 lg:px-10 lg:pt-8.5">
        <Suspense fallback={null}>
          <FocusPicker src={state.input.url} {...focus} />
        </Suspense>
      </div>
    );
  }

  if (tool.ui === 'timeline' && state.kind === 'ready') {
    return (
      <Suspense fallback={null}>
        <TimelineWorkspace
          url={state.input.url}
          video={preset.noun === 'video'}
          durationSec={media?.durationSec ?? 60}
          fps={media?.fps}
          thumbs={thumbs}
          peaks={peaks}
          range={range}
          setRange={setRange}
          multiRange={multiRange}
        />
      </Suspense>
    );
  }

  if (mask && state.kind === 'ready' && state.input.url) {
    return (
      <div className={frame}>
        <Suspense fallback={null}>
          <MaskBrush
            src={state.input.url}
            width={media?.width}
            height={media?.height}
            strokes={mask.strokes}
            onChange={mask.onChange}
          />
        </Suspense>
      </div>
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
            findFaces={preset.editor?.findFaces}
            layout={preset.editor?.layout}
          />
        </Suspense>
      </div>
    );
  }

  const previewing = state.kind === 'ready' ? preview?.state : undefined;
  if (previewing?.kind === 'done') {
    return (
      <div className={cn(frame, 'overflow-y-auto bg-surface')}>
        <div className="flex min-h-full flex-col justify-center px-4 py-8 lg:px-18">
          <Suspense fallback={null}>
            <ABPlayer
              key={previewing.at}
              original={previewing.result.original}
              result={previewing.result.result}
              fromSec={previewing.result.fromSec}
              durationSec={previewing.result.durationSec}
            />
          </Suspense>
          {preview?.changed && (
            <p className="mt-4 text-14 leading-body">
              The settings changed since this preview. Preview again to hear them.
            </p>
          )}
          {previewing.result.notes && previewing.result.notes.length > 0 && (
            <Notes title="In the preview" notes={previewing.result.notes} className="mt-6" />
          )}
        </div>
      </div>
    );
  }

  if (state.kind === 'running' || state.kind === 'ready') {
    return (
      <div className={frame}>
        <InputPreview
          input={state.input}
          noun={preset.noun}
          dim={state.kind === 'running' || previewing?.kind === 'running'}
        />
        {state.kind === 'running' && (
          <ProgressBar
            className="max-lg:inset-x-4 max-lg:bottom-4"
            title={preset.progressTitle?.(state.stage) ?? state.stage ?? 'Working'}
            fraction={state.fraction}
            meta={{ amount: state.amount, step: state.step, elapsedSec: state.elapsedSec }}
          />
        )}
        {previewing?.kind === 'running' && (
          <ProgressBar
            className="max-lg:inset-x-4 max-lg:bottom-4"
            title={`Preview: ${previewing.stage}`}
            fraction={previewing.fraction}
            meta={{ amount: previewing.amount, elapsedSec: previewing.elapsedSec }}
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
    // Headline facts from the engine (or the preset, for the demos), then the full report.
    const grid = preset.analyze?.(input) ?? output.details ?? [];
    return (
      <div className="px-4 py-6 lg:px-10 lg:pt-8.5">
        <Suspense fallback={null}>
          <FactGrid facts={grid} />
        </Suspense>
        {output.graph && (
          <Suspense fallback={null}>
            <LineGraph graph={output.graph} />
          </Suspense>
        )}
        {output.text !== undefined && (
          <pre
            tabIndex={0}
            aria-label="Full report"
            className="mt-8 overflow-x-auto border-t border-border pt-6 font-mono text-13 leading-body whitespace-pre-wrap"
          >
            {output.text}
          </pre>
        )}
      </div>
    );
  }

  if (output.swatches && output.swatches.length > 0) {
    return (
      <Suspense fallback={null}>
        <Swatches swatches={output.swatches} image={input.url} />
      </Suspense>
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
    const name =
      output.name ?? outputName(input.name, output.suffix ?? preset.outputSuffix, output.ext);
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
            {/* The header and first frame only, until played: with the
                default (auto), Linux WebKit (GStreamer) can freeze the page
                loading the result (docs/DECISIONS.md, 2026-10-02, a result's
                audio player, and a result's video player). */}
            {output.blob.type.startsWith('video/') ? (
              <video
                src={output.url}
                controls
                playsInline
                preload="metadata"
                aria-label="Result"
                className="max-h-full max-w-full"
              />
            ) : (
              <audio
                src={output.url}
                controls
                preload="metadata"
                aria-label="Result"
                className="w-full max-w-120"
              />
            )}
            <MediaTag className="left-3.5">Result</MediaTag>
          </div>
        ) : output.blob?.type.startsWith('image/') && output.url && preset.result === 'output' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface p-8 pb-24">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img
              src={output.url}
              alt="Result"
              className="checkerboard max-h-full max-w-full border border-border"
            />
            <MediaTag className="left-3.5">Result</MediaTag>
          </div>
        ) : isImage(preset) && input.url && output.url && output.blob?.type.startsWith('image/') ? (
          // A ZIP of tiles (P14) or another non-image result falls through to its file card.
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
              name:
                output.name ??
                outputName(input.name, output.suffix ?? preset.outputSuffix, output.ext),
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
