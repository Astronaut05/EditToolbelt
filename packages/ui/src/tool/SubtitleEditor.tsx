'use client';

import {
  checkCues,
  editedCue,
  ENCODING_LABELS,
  findInCues,
  fixAll,
  fixIssue,
  ISSUE_LABELS,
  mergeCues,
  readEncoding,
  readingSpeed,
  replaceInCues,
  REREAD_ENCODINGS,
  rereadCues,
  sortCues,
  splitCue,
  type CheckRules,
  type Cue,
  type Issue,
  type IssueKind,
  type RereadEncoding,
} from '@etb/core/subtitles';
import { cuesFromJson } from '@etb/engines';
import { Minus, Plus, Redo2, Scissors, Trash2, Undo2 } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { cn } from '../cn';
import { Select } from '../primitives/fields';
import { formatTimecode, parseTimecode } from './format';

/** Zoom steps: pixels a second on the timeline. */
const ZOOMS = [10, 20, 40, 80, 160, 320];
/** The shortest a cue can be dragged or typed to, ms. */
const MIN_CUE = 100;
/** Drags and nudges land on 10 ms. */
const snap = (ms: number) => Math.round(ms / 10) * 10;
const tc = (ms: number) => formatTimecode(ms / 1000);

/** Seconds between timeline labels: at least 80 px apart. */
function tickStep(pxPerSec: number): number {
  return [1, 2, 5, 10, 30, 60, 120, 300, 600].find((s) => s * pxPerSec >= 80) ?? 600;
}

/** A typed time, kept as text while typing and applied on Enter or leaving the field. */
function TimeInput({
  label,
  ms,
  onCommit,
}: {
  label: string;
  ms: number;
  onCommit: (ms: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const seconds = draft === null ? null : parseTimecode(draft);
    if (seconds !== null) onCommit(Math.round(seconds * 1000));
    setDraft(null);
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      spellCheck={false}
      value={draft ?? tc(ms)}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
      className="h-9 w-31 rounded-control border border-border bg-bg px-2 text-right font-mono text-12.5 tabular-nums text-text hover:border-text focus-visible:border-text"
    />
  );
}

/** Whether a fix changed anything: it hands back the same cues when there was no room. */
const unchanged = (next: readonly Cue[], cues: readonly Cue[]) =>
  next.length === cues.length && next.every((cue, i) => cue === cues[i]);

const toolButton =
  'inline-flex min-h-11 items-center gap-1.5 rounded-control border border-border px-3 text-14 text-text hover:border-text disabled:opacity-38 disabled:hover:border-border';

/**
 * The ToolShell's way in: the cues arrive as the option's JSON and go back as
 * JSON. The parsing loads here, with the editor, and not with the shell.
 */
export function SubtitleWorkspace({
  cues,
  onChange,
  ...rest
}: {
  cues: string | undefined;
  onChange: (json: string) => void;
  media?: File;
  rules: CheckRules;
}) {
  const list = useMemo(() => cuesFromJson(cues), [cues]);
  return (
    <SubtitleEditor
      cues={list}
      onChange={(next) => {
        onChange(JSON.stringify(next));
      }}
      {...rest}
    />
  );
}

/**
 * T03 Subtitle Editor (tools/subtitles-and-time.md): cues on a timeline under
 * the video or audio they belong to, and in a list to type in. Drag a cue to
 * move it, its edges to retime it; or focus it and use the arrow keys. Split
 * at the playhead, merge, add and delete; find and replace; and the checks
 * (line length, reading speed, duration, gaps, overlaps) with their fixes.
 * "Read as" reads the file's text again in another encoding (the shared T
 * rules' override). Every change is one step to undo. The cues live in the
 * page's options, so the download is always what's on screen.
 */
export function SubtitleEditor({
  cues,
  onChange,
  media,
  rules,
}: {
  cues: Cue[];
  onChange: (cues: Cue[]) => void;
  /** The video or audio to play along, if one was picked. */
  media?: File;
  rules: CheckRules;
}) {
  const [selected, setSelected] = useState(0);
  const [time, setTime] = useState(0);
  const [zoom, setZoom] = useState(2);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [draft, setDraft] = useState<{ index: number; cue: Cue } | null>(null);
  const [history, setHistory] = useState<{
    past: Cue[][];
    future: Cue[][];
    /** The cue being typed in: more typing there joins the same undo step. */
    typing: number | null;
  }>({ past: [], future: [], typing: null });
  const readAsId = useId();
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const drag = useRef<{
    index: number;
    edge: 'move' | 'start' | 'end';
    x0: number;
    cue: Cue;
  } | null>(null);

  const url = useMemo(() => (media ? URL.createObjectURL(media) : null), [media]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const isVideo = media
    ? media.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(media.name)
    : false;

  const pxPerSec = ZOOMS[zoom] ?? 40;
  const lastEnd = cues.reduce((max, c) => Math.max(max, c.end), 0) / 1000;
  const duration = Math.max(mediaDuration, lastEnd + 2, 10);
  const ms = Math.round(time * 1000);
  const showing = cues.findIndex((c) => c.start <= ms && ms < c.end);

  const issues = useMemo(() => checkCues(cues, rules), [cues, rules]);
  const issuesOf = useMemo(() => {
    const map = new Map<number, Issue[]>();
    for (const issue of issues) map.set(issue.index, [...(map.get(issue.index) ?? []), issue]);
    return map;
  }, [issues]);
  const counts = useMemo(() => {
    const out = new Map<IssueKind, number>();
    for (const issue of issues) out.set(issue.kind, (out.get(issue.kind) ?? 0) + 1);
    return out;
  }, [issues]);
  const matches = useMemo(
    () => findInCues(cues, query, { matchCase, wholeWord }),
    [cues, query, matchCase, wholeWord],
  );

  /** A change, as one step to undo; typing in one cue's text is one step until another edit. */
  function commit(next: Cue[], message = '', typing?: number) {
    setHistory((h) => ({
      past: typing === undefined || h.typing !== typing ? [...h.past.slice(-199), cues] : h.past,
      future: [],
      typing: typing ?? null,
    }));
    onChange(next);
    if (message) setStatus(message);
  }

  function undo() {
    const previous = history.past.at(-1);
    if (!previous) return;
    setHistory({
      past: history.past.slice(0, -1),
      future: [...history.future, cues],
      typing: null,
    });
    onChange(previous);
    setStatus('Undone');
  }

  function redo() {
    const next = history.future.at(-1);
    if (!next) return;
    setHistory({
      past: [...history.past, cues],
      future: history.future.slice(0, -1),
      typing: null,
    });
    onChange(next);
    setStatus('Redone');
  }

  function seek(seconds: number) {
    const t = Math.max(0, Math.min(duration, seconds));
    setTime(t);
    if (player.current) player.current.currentTime = t;
  }

  function select(index: number, andSeek = true) {
    const cue = cues[index];
    if (!cue) return;
    setSelected(index);
    if (andSeek) seek(cue.start / 1000);
  }

  // The playhead follows the media while it plays.
  useEffect(() => {
    const el = player.current;
    if (!el) return;
    let frame = 0;
    const tick = () => {
      setTime(el.currentTime);
      if (!el.paused) frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      frame = requestAnimationFrame(tick);
    };
    const onSeeked = () => {
      setTime(el.currentTime);
    };
    const onMeta = () => {
      setMediaDuration(Number.isFinite(el.duration) ? el.duration : 0);
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('loadedmetadata', onMeta);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('seeked', onSeeked);
      el.removeEventListener('loadedmetadata', onMeta);
    };
  }, [url]);

  // The timeline scrolls to keep the playhead in view.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const x = time * pxPerSec;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
    }
  }, [time, pxPerSec]);

  const current = cues[selected];
  const replaceCue = (index: number, cue: Cue) => cues.map((c, i) => (i === index ? cue : c));
  /** The cue moved or retimed, kept in order and still selected. */
  function retime(index: number, cue: Cue, message: string) {
    const next = sortCues(replaceCue(index, cue));
    commit(next, message);
    setSelected(next.indexOf(cue));
  }

  function split() {
    if (!current || ms <= current.start || ms >= current.end) {
      setStatus('Put the playhead inside the selected cue to split it');
      return;
    }
    const next = splitCue(cues, selected, ms, rules);
    if (next.length === cues.length) {
      setStatus(`Cue ${String(selected + 1)} is one word: there’s nothing to split`);
      return;
    }
    commit(next, `Split cue ${String(selected + 1)}`);
  }

  /** The encoding the file's text is read in, while any cue is still as read. */
  const encoding = readEncoding(cues);
  function readAs(to: RereadEncoding) {
    const next = rereadCues(cues, to);
    if (!next) {
      setStatus(`This file’s text isn’t ${ENCODING_LABELS[to]}, so it stays as it is`);
      return;
    }
    commit(next, `Read as ${ENCODING_LABELS[to]}. Cues you edited keep their text.`);
  }

  /** A fix, or a note when there was no room for it. */
  function fix(next: Cue[], done: string, none: string) {
    if (unchanged(next, cues)) setStatus(none);
    else commit(next, done);
  }

  function merge() {
    if (selected >= cues.length - 1) return;
    commit(
      mergeCues(cues, selected),
      `Merged cues ${String(selected + 1)} and ${String(selected + 2)}`,
    );
  }

  function add() {
    // At the playhead, 2 s long or up to the next cue.
    const next = cues.find((c) => c.start > ms);
    const end = Math.min(ms + 2000, next ? next.start - rules.minGap : Infinity);
    if (end - ms < MIN_CUE || cues.some((c) => c.start <= ms && ms < c.end)) {
      setStatus('No room for a new cue at the playhead');
      return;
    }
    const cue = { start: ms, end, text: '' };
    const list = sortCues([...cues, cue]);
    commit(list, 'Added a cue at the playhead');
    const index = list.indexOf(cue);
    setSelected(index);
    requestAnimationFrame(() => rows.current[index]?.querySelector('textarea')?.focus());
  }

  function remove() {
    if (!current) return;
    commit(
      cues.filter((_, i) => i !== selected),
      `Deleted cue ${String(selected + 1)}`,
    );
    setSelected(Math.max(0, Math.min(selected, cues.length - 2)));
  }

  function nextMatch() {
    const after = matches.find((m) => m.index > selected) ?? matches[0];
    if (!after) return;
    select(after.index);
    rows.current[after.index]?.scrollIntoView({ block: 'nearest' });
  }

  function replaceAll() {
    const { cues: next, count } = replaceInCues(cues, query, replacement, {
      matchCase,
      wholeWord,
    });
    if (count === 0) return;
    // A replaced text is the user's now: "Read as" leaves it alone.
    commit(
      next.map((cue, i) => (cue === cues[i] ? cue : editedCue(cue))),
      `Replaced ${String(count)} ${count === 1 ? 'match' : 'matches'}`,
    );
  }

  // Timeline drags: the cue's body moves it, its edges retime it.
  function startDrag(
    event: PointerEvent<HTMLElement>,
    index: number,
    edge: 'move' | 'start' | 'end',
  ) {
    const cue = cues[index];
    if (!cue) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { index, edge, x0: event.clientX, cue };
    setSelected(index);
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dt = snap(((event.clientX - d.x0) / pxPerSec) * 1000);
    const { start, end } = d.cue;
    const cue =
      d.edge === 'move'
        ? { ...d.cue, start: Math.max(0, start + dt), end: Math.max(0, start + dt) + (end - start) }
        : d.edge === 'start'
          ? { ...d.cue, start: Math.max(0, Math.min(end - MIN_CUE, start + dt)) }
          : { ...d.cue, end: Math.max(start + MIN_CUE, end + dt) };
    setDraft({ index: d.index, cue });
  }

  function endDrag() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    setDraft(null);
    // A click without a drag: play from the cue.
    if (!draft || (draft.cue.start === d.cue.start && draft.cue.end === d.cue.end)) {
      seek(d.cue.start / 1000);
      return;
    }
    retime(
      d.index,
      draft.cue,
      `Cue ${String(d.index + 1)}: ${tc(draft.cue.start)} to ${tc(draft.cue.end)}`,
    );
  }

  function cueKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const cue = cues[index];
    if (!cue) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      setSelected(index);
      commit(
        cues.filter((_, i) => i !== index),
        `Deleted cue ${String(index + 1)}`,
      );
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = (event.shiftKey ? 1000 : 100) * (event.key === 'ArrowLeft' ? -1 : 1);
    let next: Cue;
    if (event.altKey) next = { ...cue, end: Math.max(cue.start + MIN_CUE, cue.end + step) };
    else if (event.ctrlKey || event.metaKey) {
      next = { ...cue, start: Math.max(0, Math.min(cue.end - MIN_CUE, cue.start + step)) };
    } else {
      const start = Math.max(0, cue.start + step);
      next = { ...cue, start, end: start + (cue.end - cue.start) };
    }
    retime(index, next, `Cue ${String(index + 1)}: ${tc(next.start)} to ${tc(next.end)}`);
  }

  const step = tickStep(pxPerSec);
  const width = duration * pxPerSec;

  return (
    <div className="flex flex-col gap-5 px-4 py-6 lg:px-10 lg:pt-8.5">
      {url ? (
        <div className="relative flex justify-center bg-media-scrim">
          {isVideo ? (
            <video
              ref={player}
              src={url}
              controls
              playsInline
              aria-label="Video"
              className="max-h-72 max-w-full"
            />
          ) : (
            <audio ref={player} src={url} controls aria-label="Audio" className="w-full" />
          )}
          {isVideo && showing >= 0 && (
            <p
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-4 bottom-12 text-center text-16 leading-tight font-strong whitespace-pre-line text-media-text [text-shadow:0_1px_3px_#000]"
            >
              {cues[showing]?.text.replace(/<\/?[biu]>/g, '')}
            </p>
          )}
        </div>
      ) : (
        <p className="text-14 text-text-muted">
          Pick a video or audio file in the settings to play it along with the cues.
        </p>
      )}

      <div role="toolbar" aria-label="Edit cues" className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={split} disabled={!current} className={toolButton}>
          <Scissors size={16} aria-hidden="true" />
          Split at playhead
        </button>
        <button
          type="button"
          onClick={merge}
          disabled={selected >= cues.length - 1}
          className={toolButton}
        >
          Merge with next
        </button>
        <button type="button" onClick={add} className={toolButton}>
          <Plus size={16} aria-hidden="true" />
          Add cue
        </button>
        <button type="button" onClick={remove} disabled={!current} className={toolButton}>
          <Trash2 size={16} aria-hidden="true" />
          Delete cue
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={history.past.length === 0}
          className={toolButton}
        >
          <Undo2 size={16} aria-hidden="true" />
          Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={history.future.length === 0}
          className={toolButton}
        >
          <Redo2 size={16} aria-hidden="true" />
          Redo
        </button>
        {encoding && (
          <span className="inline-flex items-center gap-2">
            <label htmlFor={readAsId} className="text-14 text-text-muted">
              Read as
            </label>
            <Select
              id={readAsId}
              value={encoding}
              onChange={(event) => {
                readAs(event.target.value as RereadEncoding);
              }}
            >
              {REREAD_ENCODINGS.map((option) => (
                <option key={option} value={option}>
                  {ENCODING_LABELS[option]}
                </option>
              ))}
            </Select>
          </span>
        )}
        <span className="ml-auto inline-flex items-center rounded-control border border-border text-text-muted">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom === 0}
            onClick={() => {
              setZoom(zoom - 1);
            }}
            className="inline-flex size-11 items-center justify-center hover:text-text disabled:opacity-38"
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <output aria-label="Timeline zoom" className="w-16 text-center font-mono text-12">
            {pxPerSec} px/s
          </output>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom === ZOOMS.length - 1}
            onClick={() => {
              setZoom(zoom + 1);
            }}
            className="inline-flex size-11 items-center justify-center hover:text-text disabled:opacity-38"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </span>
      </div>
      <p role="status" className="min-h-5 text-14 text-text-muted">
        {status}
      </p>

      <div ref={strip} className="overflow-x-auto border border-border">
        <div
          role="group"
          aria-label="Cue timeline. Click to move the playhead. On a cue: arrow keys move it by 0.1 s (Shift: 1 s), with Alt they move its end, with Ctrl its start; Delete removes it."
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            seek((event.clientX - rect.left) / pxPerSec);
          }}
          className="relative h-28 touch-none bg-surface select-none"
          style={{ width: `${String(width)}px` }}
        >
          {Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute top-0 h-full border-l border-border pl-1 font-mono text-11 text-text-muted"
              style={{ left: `${String(i * step * pxPerSec)}px` }}
            >
              {formatTimecode(i * step).slice(3, 8)}
            </span>
          ))}
          {cues.map((original, i) => {
            const cue = draft?.index === i ? draft.cue : original;
            const bad = issuesOf.has(i);
            return (
              <button
                key={i}
                type="button"
                aria-pressed={i === selected}
                aria-label={`Cue ${String(i + 1)}: ${tc(cue.start)} to ${tc(cue.end)}${bad ? ', has issues' : ''}`}
                onPointerDown={(event) => {
                  startDrag(event, i, 'move');
                }}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onKeyDown={(event) => {
                  cueKeys(event, i);
                }}
                onFocus={() => {
                  setSelected(i);
                }}
                className={cn(
                  'absolute top-6 bottom-2 overflow-hidden rounded-control border px-1.5 text-left text-12 leading-tight',
                  i === selected
                    ? 'z-10 border-text bg-accent text-accent-contrast'
                    : bad
                      ? 'border-danger bg-bg text-text'
                      : 'border-border-strong bg-bg text-text',
                )}
                style={{
                  left: `${String((cue.start / 1000) * pxPerSec)}px`,
                  width: `${String(Math.max(4, ((cue.end - cue.start) / 1000) * pxPerSec))}px`,
                }}
              >
                <span aria-hidden="true" className="line-clamp-3 whitespace-pre-line">
                  {cue.text.replace(/<\/?[biu]>/g, '')}
                </span>
                {(['start', 'end'] as const).map((edge) => (
                  <span
                    key={edge}
                    aria-hidden="true"
                    onPointerDown={(event) => {
                      startDrag(event, i, edge);
                    }}
                    className={cn(
                      'absolute inset-y-0 w-2 cursor-ew-resize',
                      edge === 'start' ? 'left-0' : 'right-0',
                    )}
                  />
                ))}
              </button>
            );
          })}
          <div
            aria-hidden="true"
            className="absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-accent"
            style={{ left: `${String(time * pxPerSec)}px` }}
          />
        </div>
      </div>
      <p className="-mt-3 font-mono text-12 tracking-meta text-text-muted uppercase">
        Playhead <b className="font-medium text-text">{formatTimecode(time)}</b> · {cues.length}{' '}
        cues
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Find and replace" className="flex flex-col gap-2">
          <h2 className="text-15 font-strong">Find and replace</h2>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Find"
              placeholder="Find"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              className="h-11 min-w-0 flex-1 rounded-control border border-border bg-bg px-3 text-14 hover:border-text focus-visible:border-text"
            />
            <input
              aria-label="Replace with"
              placeholder="Replace with"
              value={replacement}
              onChange={(event) => {
                setReplacement(event.target.value);
              }}
              className="h-11 min-w-0 flex-1 rounded-control border border-border bg-bg px-3 text-14 hover:border-text focus-visible:border-text"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-14">
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(event) => {
                  setMatchCase(event.target.checked);
                }}
              />
              Match case
            </label>
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(event) => {
                  setWholeWord(event.target.checked);
                }}
              />
              Whole words
            </label>
            <span className="text-text-muted">
              {query ? `${String(matches.length)} found` : ''}
            </span>
            <button
              type="button"
              onClick={nextMatch}
              disabled={matches.length === 0}
              className={toolButton}
            >
              Next
            </button>
            <button
              type="button"
              onClick={replaceAll}
              disabled={matches.length === 0}
              className={toolButton}
            >
              Replace all
            </button>
          </div>
        </section>

        <section aria-label="Checks" className="flex flex-col gap-2">
          <h2 className="text-15 font-strong">Checks</h2>
          {issues.length === 0 ? (
            <p className="text-14 text-text-muted">
              Every cue passes: {rules.maxCpl} characters a line, {rules.maxLines} lines,{' '}
              {rules.maxCps} characters a second, {rules.minGap} ms apart.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {[...counts].map(([kind, count]) => (
                <li key={kind} className="flex items-center justify-between gap-3 text-14">
                  <span>
                    {ISSUE_LABELS[kind]}: <b className="font-strong">{count}</b>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      fix(
                        fixAll(cues, kind, rules),
                        `${ISSUE_LABELS[kind]}: fixed where there was room`,
                        `${ISSUE_LABELS[kind]}: no room to fix any without making a cue too short`,
                      );
                    }}
                    className={toolButton}
                  >
                    Fix all
                    <span className="sr-only"> {ISSUE_LABELS[kind].toLowerCase()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ol
        aria-label="Cues"
        className="flex flex-col border-t border-border lg:max-h-[70vh] lg:overflow-y-auto"
      >
        {cues.map((cue, i) => {
          const own = issuesOf.get(i) ?? [];
          const cps = readingSpeed(cue);
          return (
            <li
              key={i}
              ref={(el) => {
                rows.current[i] = el;
              }}
              className={cn(
                'grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 border-b border-border py-3 lg:grid-cols-[3rem_auto_1fr_auto]',
                i === selected && 'bg-surface',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  select(i);
                }}
                aria-label={`Play from cue ${String(i + 1)}`}
                className="min-h-11 rounded-control px-2 text-left font-mono text-13 text-text-muted hover:text-text"
              >
                {i + 1}
              </button>
              <div className="flex flex-wrap items-center gap-1.5 lg:flex-col lg:items-stretch">
                <TimeInput
                  label={`Cue ${String(i + 1)} start`}
                  ms={cue.start}
                  onCommit={(start) => {
                    retime(
                      i,
                      { ...cue, start: Math.min(start, cue.end - MIN_CUE) },
                      `Cue ${String(i + 1)} starts at ${tc(start)}`,
                    );
                  }}
                />
                <TimeInput
                  label={`Cue ${String(i + 1)} end`}
                  ms={cue.end}
                  onCommit={(end) => {
                    retime(
                      i,
                      { ...cue, end: Math.max(end, cue.start + MIN_CUE) },
                      `Cue ${String(i + 1)} ends at ${tc(end)}`,
                    );
                  }}
                />
              </div>
              <textarea
                aria-label={`Cue ${String(i + 1)} text`}
                value={cue.text}
                rows={2}
                onFocus={() => {
                  setSelected(i);
                }}
                onChange={(event) => {
                  commit(replaceCue(i, editedCue({ ...cue, text: event.target.value })), '', i);
                }}
                className="col-span-2 min-h-16 w-full rounded-control border border-border bg-bg px-3 py-2 text-15 leading-snug hover:border-text focus-visible:border-text lg:col-span-1"
              />
              <div className="col-span-2 flex flex-col gap-1 text-13 lg:col-span-1 lg:w-56">
                <span className="font-mono text-12 text-text-muted tabular-nums">
                  {((cue.end - cue.start) / 1000).toFixed(2)} s · {cps.toFixed(1)} cps
                </span>
                {own.map((issue) => (
                  <span
                    key={issue.kind}
                    className="flex flex-wrap items-center gap-x-2 text-danger"
                  >
                    {issue.detail}
                    <button
                      type="button"
                      onClick={() => {
                        fix(
                          fixIssue(cues, issue, rules),
                          `Cue ${String(i + 1)}: fixed`,
                          `Cue ${String(i + 1)}: no room to fix this without making a cue too short`,
                        );
                      }}
                      className="min-h-11 text-text underline-offset-2 hover:underline"
                    >
                      Fix<span className="sr-only">: {issue.detail}</span>
                    </button>
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
