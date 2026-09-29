'use client';

import type { Engine } from '@etb/engines';
import { ChevronRight, Download } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { cn } from '../cn';
import { AppLink } from '../primitives/AppLink';
import { Breadcrumb } from '../primitives/Breadcrumb';
import { Button } from '../primitives/Button';
import { Kbd } from '../primitives/Kbd';
import { NumberedList } from '../primitives/NumberedList';
import { OptionFact, OptionRow, OptionsPanel } from '../primitives/OptionsPanel';
import { Dialog } from '../primitives/overlays';
import { PrivacyBadge, type Noun } from '../primitives/PrivacyBadge';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { StatePanel } from '../primitives/states';
import { BatchList, type BatchItem } from './BatchList';
import { BeforeAfter, MediaTag } from './BeforeAfter';
import { CanvasEditor, type EditorMode } from './CanvasEditor';
import { DropZone } from './DropZone';
import { FactGrid, type GridFact } from './FactGrid';
import { durationBucket, formatBytes, outputName, sizeBucket } from './format';
import { ProgressBar } from './ProgressBar';
import { Readout, ReadoutRow, type Fact } from './Readout';
import { Timeline, type TimelineRange } from './Timeline';

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
  choices: { value: string; label: string }[];
  default: string;
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
  /** Read-only facts in the settings list (the AI model). */
  facts?: (state: ShellState) => { label: string; value: string }[];
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
  /** Canvas editor presets: the mode it opens in, or compare view. */
  editor?: { mode?: EditorMode; modes?: EditorMode[]; compare?: boolean };
  /** Analyzer results (dummy data in M1). */
  analyze?: (input: InputInfo) => GridFact[];
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
}

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
  | { kind: 'result'; input: InputInfo; output: OutputInfo }
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
}: ToolShellProps) {
  const [state, setState] = useState<ShellState>(initialState ?? { kind: 'empty' });
  const [options, setOptions] = useState<Record<string, string>>(
    initialOptions ?? defaults(preset.options),
  );
  const [range, setRange] = useState<TimelineRange>({ start: 0, end: 12 });
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [sheet, setSheet] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);

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
    async (input: InputInfo, file: Blob) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const started = performance.now();
      track('tool_run_started', { path: 'client' });
      setState({ kind: 'running', input, fraction: 0, elapsedSec: 0 });
      try {
        const out = await engine.run(
          file,
          { ...engineOptions, ...options },
          {
            signal: abort.signal,
            progress: (fraction, stage) => {
              setState({
                kind: 'running',
                input,
                fraction,
                stage,
                elapsedSec: (performance.now() - started) / 1000,
              });
            },
          },
        );
        const url = URL.createObjectURL(out.blob);
        urls.current.push(url);
        const seconds = (performance.now() - started) / 1000;
        track('tool_run_succeeded', {
          engine_path: out.path,
          duration: durationBucket(seconds * 1000),
        });
        setState({
          kind: 'result',
          input,
          output: {
            size: out.blob.size,
            ext: preset.outputExt(options),
            url,
            blob: out.blob,
            seconds,
            path: out.path,
            width: out.width ?? input.width,
            height: out.height ?? input.height,
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
          body: `${error instanceof Error ? error.message : 'Unknown error'}. Try again, or try another file.`,
        });
      }
    },
    [engine, engineOptions, options, preset, track],
  );

  const intake = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      const input: InputInfo = { name: file.name, size: file.size, url };
      track('tool_file_added', {
        mime: file.type.split('/')[0] || 'unknown',
        size: sizeBucket(file.size),
      });
      if (tool.ui === 'batch') {
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
      if (preset.autoRun) void run(input, file);
      else setState({ kind: 'ready', input, files });
    },
    [preset.autoRun, run, tool.ui, track],
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
    for (const [index, file] of files.entries()) {
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
        update({ status: 'done', resultSize: out.blob.size });
      } catch {
        if (abort.signal.aborted) return;
        update({ status: 'failed', error: "Couldn't read this file." });
      }
    }
  }

  const cancel = useCallback(() => {
    controller.current?.abort();
    setState({ kind: 'empty' });
    setBatch([]);
  }, []);

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
      if (event.key === 'Escape' && state.kind === 'running') {
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
  const ext = preset.outputExt(options).toUpperCase();
  const facts = preset.facts?.(state) ?? [];
  const phoneGroups = useMemo(
    () => preset.phoneGroups ?? preset.options.map((option) => [option.id]),
    [preset.options, preset.phoneGroups],
  );

  if (tool.ui === 'calculator') return <CalculatorShell tool={tool} />;

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

  const settings = (
    <OptionsPanel className="mt-6.5 hidden lg:block">
      {preset.options.map((option) => (
        <OptionRow key={option.id} label={option.label}>
          <SegmentedControl
            label={option.label}
            options={option.choices}
            value={options[option.id] ?? option.default}
            onChange={(value) => {
              setOptions({ ...options, [option.id]: value });
            }}
          />
        </OptionRow>
      ))}
      {facts.map((fact) => (
        <OptionFact key={fact.label} label={fact.label}>
          {fact.value}
        </OptionFact>
      ))}
    </OptionsPanel>
  );

  const running = state.kind === 'running';
  const result = state.kind === 'result';
  const actions = hasFile && (
    <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2.5 border-t border-border bg-bg px-4 pt-3 pb-6.5 lg:static lg:mt-6.5 lg:gap-3 lg:border-0 lg:bg-transparent lg:p-0">
      {state.kind === 'ready' ? (
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => {
            if (tool.ui === 'batch' && state.files) void runBatch(state.files);
            else if (state.files?.[0]) void run(state.input, state.files[0]);
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
      onDownloadItem={() => undefined}
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
        {running && preset.runningNote && (
          <p className="mt-3.5 hidden text-14 leading-body text-text-muted lg:block">
            {preset.runningNote}
          </p>
        )}
        {next && <div className="hidden lg:block">{next}</div>}
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
          <div className="mx-4 mt-4 rounded-card border border-border">
            {phoneGroups.map((group, index) => {
              const groupOptions = group
                .map((id) => preset.options.find((option) => option.id === id))
                .filter((option): option is ShellOption => Boolean(option));
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
                      .map(
                        (option) =>
                          option.choices.find((choice) => choice.value === options[option.id])
                            ?.label,
                      )
                      .join(' · ')}
                    <ChevronRight aria-hidden="true" size={16} strokeWidth={2} />
                  </span>
                </button>
              );
            })}
          </div>
          {next}
          <Dialog
            open={sheet !== null}
            onClose={() => {
              setSheet(null);
            }}
            title="Settings"
            variant="sheet"
          >
            {(phoneGroups[sheet ?? 0] ?? []).map((id) => {
              const option = preset.options.find((candidate) => candidate.id === id);
              if (!option) return null;
              return (
                <OptionRow key={option.id} label={option.label}>
                  <SegmentedControl
                    label={option.label}
                    options={option.choices}
                    value={options[option.id] ?? option.default}
                    onChange={(value) => {
                      setOptions({ ...options, [option.id]: value });
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
}: {
  state: ShellState;
  tool: ShellTool;
  preset: ShellPreset;
  range: TimelineRange;
  setRange: (range: TimelineRange) => void;
  batch: BatchItem[];
  onDownloadItem: (id: string) => void;
}) {
  if (state.kind !== 'running' && state.kind !== 'result' && state.kind !== 'ready') return null;
  const frame = 'relative h-98 overflow-hidden lg:absolute lg:inset-0 lg:h-auto';

  if (tool.ui === 'batch') {
    return (
      <div className="px-4 py-6 lg:px-10 lg:pt-8.5">
        <BatchList items={batch} onDownload={onDownloadItem} />
      </div>
    );
  }

  if (tool.ui === 'timeline' && state.kind === 'ready') {
    return (
      <div className="px-4 py-6 lg:px-10 lg:pt-8.5">
        <Timeline
          durationSec={60}
          kind={preset.noun === 'video' ? 'video' : 'audio'}
          value={range}
          onChange={setRange}
        />
      </div>
    );
  }

  if (tool.ui === 'canvas-editor' && state.kind === 'ready' && !preset.editor?.compare) {
    return (
      <div className={frame}>
        <CanvasEditor
          initialMode={preset.editor?.mode}
          enabledModes={preset.editor?.modes}
          image={
            state.input.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL
              <img src={state.input.url} alt="" className="size-full object-contain" />
            ) : null
          }
        />
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
    { label: 'Size', value: `${formatBytes(input.size)} → ${formatBytes(output.size)}` },
    { label: 'Time', value: `${output.seconds.toFixed(1)} s` },
    { label: 'Engine', value: output.path },
  ];

  return (
    <>
      <div className={frame}>
        {isImage(preset) && input.url && output.url ? (
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

/** Calculators: inputs left, live results right in mono (design README → Not drawn yet). */
function CalculatorShell({ tool }: { tool: ShellTool }) {
  const [width, setWidth] = useState('1920');
  const [height, setHeight] = useState('1080');
  const w = Number(width);
  const h = Number(height);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const valid = Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0;
  const g = valid ? gcd(w, h) : 1;
  const results: GridFact[] = valid
    ? [
        { label: 'Ratio', value: `${String(w / g)}:${String(h / g)}` },
        { label: 'Decimal', value: (w / h).toFixed(3) },
        { label: 'Pixels', value: (w * h).toLocaleString('en-US'), unit: 'px' },
        { label: 'Megapixels', value: ((w * h) / 1e6).toFixed(2), unit: 'MP' },
      ]
    : [];
  return (
    <div className="lg:grid lg:min-h-[calc(100dvh-var(--header-h))] lg:grid-cols-[var(--tool-left-col)_1fr]">
      <section aria-label="Inputs" className="px-4 lg:border-r lg:border-border lg:px-10 lg:pt-8.5">
        <Breadcrumb
          items={[{ label: tool.category.name, href: tool.category.href }, { label: tool.name }]}
          className="pt-5.5 lg:pt-0"
        />
        <h1 className="mt-3 text-34 leading-display font-display tracking-display lg:mt-4.5 lg:text-46">
          {tool.h1}
        </h1>
        <p className="mt-3 text-15.5 text-text-muted lg:mt-3.5 lg:text-16.5">{tool.tagline}</p>
        <OptionsPanel className="mt-6.5">
          <OptionRow label="Width" htmlFor="calc-w">
            <UnitInput id="calc-w" value={width} onChange={setWidth} />
          </OptionRow>
          <OptionRow label="Height" htmlFor="calc-h">
            <UnitInput id="calc-h" value={height} onChange={setHeight} />
          </OptionRow>
        </OptionsPanel>
      </section>
      <section aria-label="Results" aria-live="polite" className="px-4 py-6 lg:px-10 lg:pt-8.5">
        {valid ? (
          <FactGrid facts={results} />
        ) : (
          <p className="text-14 text-text-muted">Enter a width and height in whole pixels.</p>
        )}
      </section>
    </div>
  );
}

function UnitInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <span className="relative inline-flex w-36 items-center">
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-11 w-full rounded-control border border-border bg-bg pr-10 pl-3 text-right font-mono text-14 hover:border-text"
      />
      <span className="pointer-events-none absolute right-3 font-mono text-12 uppercase text-text-muted">
        px
      </span>
    </span>
  );
}
