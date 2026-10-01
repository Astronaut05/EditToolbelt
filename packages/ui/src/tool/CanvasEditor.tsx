'use client';

import {
  defaultAmount,
  faceArea,
  maxAmount,
  turnedSize,
  type Redact,
  type Size,
} from '@etb/engines';
import {
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Highlighter,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  Scaling,
  Type,
  Undo2,
  Waves,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '../cn';
import { Slider } from '../primitives/fields';
import {
  BlurBar,
  BlurLayer,
  centredBox,
  type BlurPen,
  type FaceFinder,
  type FaceSearch,
} from './BlurLayer';
import { boxLabel, dragHandle, moveBox, turnEdit, type Edit, type Handle } from './crop';
import { DrawBar, DrawLayer, defaultSize, type DrawStyle } from './DrawLayer';
import { TextBar } from './TextBar';
import { newTextLayer, TextLayers } from './TextLayers';
import type { EditorState } from './useEditor';

export type EditorMode =
  | 'crop'
  | 'straighten'
  | 'resize'
  | 'rotate-left'
  | 'rotate'
  | 'flip'
  | 'flip-v'
  | 'draw'
  | 'text'
  | 'blur';

const icon = (Icon: typeof Crop) => <Icon size={16} strokeWidth={1.75} aria-hidden="true" />;

const MODES: { id: EditorMode; label: string; icon: ReactNode }[] = [
  { id: 'crop', label: 'Crop', icon: icon(Crop) },
  { id: 'straighten', label: 'Straighten', icon: icon(Ruler) },
  { id: 'resize', label: 'Resize', icon: icon(Scaling) },
  { id: 'rotate-left', label: 'Rotate left', icon: icon(RotateCcw) },
  { id: 'rotate', label: 'Rotate 90°', icon: icon(RotateCw) },
  { id: 'flip', label: 'Flip', icon: icon(FlipHorizontal2) },
  { id: 'flip-v', label: 'Flip vertical', icon: icon(FlipVertical2) },
  { id: 'draw', label: 'Draw', icon: icon(Highlighter) },
  { id: 'text', label: 'Text', icon: icon(Type) },
  { id: 'blur', label: 'Blur', icon: icon(Waves) },
];

/** Rotations and flips act at once; the rest are modes. */
const ACTIONS: readonly EditorMode[] = ['rotate-left', 'rotate', 'flip', 'flip-v'];

/** Straighten's range and step, degrees (tools/photo.md → P04). */
const MAX_ANGLE = 45;

const HANDLES: { id: Handle; className: string; cursor: string }[] = [
  { id: 'nw', className: '-top-4 -left-4', cursor: 'cursor-nwse-resize' },
  { id: 'ne', className: '-top-4 -right-4', cursor: 'cursor-nesw-resize' },
  { id: 'sw', className: '-bottom-4 -left-4', cursor: 'cursor-nesw-resize' },
  { id: 'se', className: '-bottom-4 -right-4', cursor: 'cursor-nwse-resize' },
  { id: 'n', className: '-top-4 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
  { id: 's', className: '-bottom-4 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
  { id: 'w', className: 'top-1/2 -left-4 -translate-y-1/2', cursor: 'cursor-ew-resize' },
  { id: 'e', className: 'top-1/2 -right-4 -translate-y-1/2', cursor: 'cursor-ew-resize' },
];

/** Space around the image inside the frame, px. */
const GUTTER = 32;
/** Smallest crop box on screen, px. */
const MIN_BOX_PX = 24;

export interface CanvasEditorProps {
  /** Image URL (object URL or sample path). */
  src: string;
  editor: EditorState;
  /** Width / height the crop box keeps, or null for free. */
  ratio?: number | null;
  initialMode?: EditorMode;
  /** Modes the preset shows; all by default. */
  enabledModes?: EditorMode[];
  /** P12: finds faces for blur mode's "Find faces"; without it the button isn't shown. */
  findFaces?: FaceFinder;
  className?: string;
}

interface Drag {
  pointer: number;
  handle: Handle | 'move';
  startX: number;
  startY: number;
  /** Source pixels per screen pixel. */
  scale: number;
  edit: Edit;
}

/**
 * The shared photo editor (docs/03 → CanvasEditor): a mode toolbar (the preset
 * opens one mode, the rest one tap away), undo/redo, zoom, and the image with
 * the current mode's controls. Crop mode draws a box with eight handles,
 * thirds lines and its size in px; drag it, or focus it and use the arrow
 * keys. The page owns the edit (useEditor), so settings fields and the box
 * stay in step; the engine applies the same edit to the full-size image.
 */
export function CanvasEditor({
  src,
  editor,
  ratio = null,
  initialMode = 'crop',
  enabledModes,
  findFaces,
  className,
}: CanvasEditorProps) {
  const { edit, onEdit, natural, onNatural, history } = editor;
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [zoom, setZoom] = useState(100);
  /** P09: the pen as changed; until then, a red arrow sized for the image. */
  const [penChoice, setPen] = useState<DrawStyle | null>(null);
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const angleId = useId();
  const modes = MODES.filter((m) => !enabledModes || enabledModes.includes(m.id));

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFrame({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const pen: DrawStyle | null =
    penChoice ??
    (natural ? { tool: 'arrow', color: '#e53935', size: defaultSize(natural), opacity: 1 } : null);
  const marks = edit.marks ?? [];
  const texts = edit.texts ?? [];
  /** P10: the text layer being edited. */
  const [selectedText, setSelectedText] = useState<string | null>(null);
  /** P12: the shape blur mode draws, and the face search. */
  const [blurPenChoice, setBlurPen] = useState<BlurPen | null>(null);
  const [search, setSearch] = useState<FaceSearch>({ kind: 'idle' });
  const searching = useRef<AbortController | null>(null);
  const latest = useRef(edit);
  useEffect(() => {
    latest.current = edit;
  });
  useEffect(
    () => () => {
      searching.current?.abort();
    },
    [],
  );
  const blurPen: BlurPen | null =
    blurPenChoice ??
    (natural
      ? {
          shape: 'rect',
          brush: Math.max(8, Math.round(Math.max(natural.width, natural.height) / 30)),
        }
      : null);
  const redact: Redact | null =
    edit.redact ??
    (natural
      ? { effect: 'blur', amount: defaultAmount(natural), color: '#000000', areas: [] }
      : null);

  /** Finds faces and hides them all, replacing faces found before; drawn areas stay. One undo step. */
  function find() {
    if (!findFaces || !natural) return;
    searching.current?.abort();
    const controller = new AbortController();
    searching.current = controller;
    setSearch({ kind: 'running', label: 'Finding faces' });
    findFaces(src, controller.signal, (progress) => {
      if (!controller.signal.aborted) {
        setSearch({ kind: 'running', label: progress.label, amount: progress.amount });
      }
    }).then(
      (faces) => {
        if (controller.signal.aborted) return;
        const now = latest.current;
        const current = now.redact ?? redact;
        if (!current) return;
        const bounds = { x: 0, y: 0, ...natural };
        onEdit({
          ...now,
          redact: {
            ...current,
            areas: [
              ...current.areas.filter((area) => area.face === undefined),
              ...faces.map((face) => faceArea(face, bounds)),
            ],
          },
        });
        setSearch({ kind: 'done', count: faces.length });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setSearch({
          kind: 'error',
          message:
            error instanceof Error ? error.message.replace(/\.$/, '') : 'Faces couldn’t be found',
        });
      },
    );
  }

  const turned = natural ? turnedSize(natural, edit.turns) : null;
  const fit =
    turned && frame.width > 0
      ? Math.min(
          (frame.width - 2 * GUTTER) / turned.width,
          (frame.height - 2 * GUTTER) / turned.height,
        )
      : 0;
  const stage = turned && { width: turned.width * fit, height: turned.height * fit };

  function act(next: EditorMode) {
    if (next === 'rotate' && natural) onEdit(turnEdit(edit, natural, ratio));
    else if (next === 'rotate-left' && natural) {
      // Three quarter turns right, so the crop box follows the same way.
      const once = turnEdit(edit, natural, ratio);
      const twice = turnEdit(once, natural, ratio);
      onEdit(turnEdit(twice, natural, ratio));
    } else if (next === 'flip') onEdit({ ...edit, flip: !edit.flip });
    else if (next === 'flip-v') onEdit({ ...edit, flipV: !edit.flipV });
    else setMode(next);
  }

  /** Straighten's slider moves the view live; letting go makes it one undo step. */
  const setAngle = (value: number, done: boolean) => {
    const angle = Math.round(Math.min(MAX_ANGLE, Math.max(-MAX_ANGLE, value)) * 10) / 10;
    onEdit({ ...edit, angle }, !done);
  };

  /**
   * A drag follows the pointer on the window until it lifts, so it keeps
   * working when the pointer leaves the box or the box re-renders under it.
   */
  function startDrag(event: PointerEvent<HTMLElement>, handle: Handle | 'move') {
    if (!turned || !stageRef.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = stageRef.current.getBoundingClientRect();
    const current: Drag = {
      pointer: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      scale: turned.width / rect.width,
      edit,
    };
    const bounds = turned;
    let last = current.edit;
    const follow = (e: globalThis.PointerEvent, done: boolean) => {
      if (e.pointerId !== current.pointer || !current.edit.crop) return;
      const dx = (e.clientX - current.startX) * current.scale;
      const dy = (e.clientY - current.startY) * current.scale;
      const crop =
        current.handle === 'move'
          ? moveBox(current.edit.crop, dx, dy, bounds)
          : dragHandle(
              current.edit.crop,
              current.handle,
              dx,
              dy,
              bounds,
              ratio,
              Math.ceil(MIN_BOX_PX * current.scale),
            );
      last = { ...current.edit, crop };
      onEdit(last, !done);
    };
    const move = (e: globalThis.PointerEvent) => {
      follow(e, false);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
    };
    const end = (e: globalThis.PointerEvent) => {
      follow(e, true);
      stop();
    };
    // A cancelled pointer has no usable position: keep where the box got to.
    const cancel = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== current.pointer) return;
      onEdit(last);
      stop();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
  }

  function onBoxKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!turned || !edit.crop) return;
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onEdit({ ...edit, crop: moveBox(edit.crop, move[0], move[1], turned) });
  }

  // The box and its handles start a drag; a handle names itself in data-handle.
  const pointer = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      startDrag(event, (event.currentTarget.dataset.handle as Handle | undefined) ?? 'move');
    },
  };

  const box = edit.crop;
  const imageSize = natural && { width: natural.width * fit, height: natural.height * fit };

  return (
    <div className={cn('absolute inset-0 flex flex-col bg-surface', className)}>
      <div
        role="toolbar"
        aria-label="Editor"
        className="flex h-12 flex-none items-center gap-1 overflow-x-auto border-b border-border bg-bg px-3"
      >
        {modes.map((m) => {
          const isAction = ACTIONS.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={isAction ? undefined : mode === m.id}
              disabled={isAction && !natural}
              onClick={() => {
                act(m.id);
              }}
              className={cn(
                'inline-flex h-11 flex-none items-center gap-2 px-2.5 text-14 disabled:opacity-38',
                !isAction && mode === m.id
                  ? 'font-strong text-text'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {m.icon}
              <span className={cn(!isAction && mode === m.id && 'underline-accent')}>
                {m.label}
              </span>
            </button>
          );
        })}
        <span aria-hidden="true" className="mx-2 h-5 w-px flex-none bg-border" />
        <IconButton label="Undo" disabled={!history.canUndo} onClick={history.undo}>
          <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
        <IconButton label="Redo" disabled={!history.canRedo} onClick={history.redo}>
          <Redo2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
        <span className="ml-auto hidden flex-none items-center gap-1 sm:flex">
          <IconButton
            label="Zoom out"
            disabled={zoom <= 25}
            onClick={() => {
              setZoom(Math.max(25, zoom - 25));
            }}
          >
            <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
          <output aria-label="Zoom" className="w-12 text-center font-mono text-12.5 text-text">
            {zoom}%
          </output>
          <IconButton
            label="Zoom in"
            disabled={zoom >= 400}
            onClick={() => {
              setZoom(Math.min(400, zoom + 25));
            }}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </span>
      </div>
      {mode === 'straighten' && (
        <div className="flex h-12 flex-none items-center gap-3 border-b border-border bg-bg px-4">
          <label htmlFor={angleId} className="text-14 text-text-muted">
            Angle
          </label>
          <Slider
            id={angleId}
            min={-MAX_ANGLE}
            max={MAX_ANGLE}
            step={0.1}
            value={edit.angle}
            disabled={!natural}
            aria-valuetext={`${String(edit.angle)}°`}
            onChange={(event) => {
              setAngle(Number(event.target.value), false);
            }}
            onPointerUp={(event) => {
              setAngle(Number(event.currentTarget.value), true);
            }}
            onKeyUp={(event) => {
              setAngle(Number(event.currentTarget.value), true);
            }}
            className="min-w-0 flex-1 sm:max-w-80"
          />
          <output htmlFor={angleId} className="w-14 text-right font-mono text-12.5 text-text">
            {edit.angle.toFixed(1)}°
          </output>
          <button
            type="button"
            disabled={edit.angle === 0}
            onClick={() => {
              setAngle(0, true);
            }}
            className="text-14 text-text-muted hover:text-text disabled:opacity-38"
          >
            Reset
          </button>
        </div>
      )}
      {mode === 'draw' && natural && pen && (
        <DrawBar
          style={pen}
          onStyle={setPen}
          maxSize={Math.max(20, Math.round(Math.max(natural.width, natural.height) / 20))}
          canClear={marks.length > 0}
          onClear={() => {
            onEdit({ ...edit, marks: [] });
          }}
        />
      )}
      {mode === 'blur' && natural && blurPen && redact && (
        <BlurBar
          pen={blurPen}
          onPen={setBlurPen}
          redact={redact}
          onRedact={(next, transient) => {
            onEdit({ ...edit, redact: next }, transient);
          }}
          natural={natural}
          maxStrength={maxAmount(natural)}
          search={search}
          onFind={findFaces ? find : undefined}
          onAddBox={() => {
            onEdit({
              ...edit,
              redact: { ...redact, areas: [...redact.areas, centredBox(natural)] },
            });
          }}
        />
      )}
      {mode === 'text' && natural && (
        <TextBar
          layers={texts}
          selected={selectedText}
          onSelect={setSelectedText}
          onLayers={(next, transient) => {
            onEdit({ ...edit, texts: next }, transient);
          }}
          onAdd={() => {
            const added = newTextLayer(natural);
            onEdit({ ...edit, texts: [...texts, added] });
            setSelectedText(added.id);
          }}
        />
      )}
      <div ref={frameRef} className="relative min-h-0 flex-1 overflow-hidden">
        {/* Loads the image to learn its size; the stage shows it once known. */}
        {!natural && (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL, measured only
          <img
            src={src}
            alt=""
            className="invisible absolute size-px"
            onLoad={(event) => {
              const img = event.currentTarget;
              if (img.naturalWidth > 0) {
                onNatural({ width: img.naturalWidth, height: img.naturalHeight });
              }
            }}
          />
        )}
        {stage && imageSize && fit > 0 && (
          <div
            ref={stageRef}
            className="absolute"
            style={{
              left: (frame.width - stage.width) / 2,
              top: (frame.height - stage.height) / 2,
              width: stage.width,
              height: stage.height,
              transform: `scale(${String(zoom / 100)})`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img
              src={src}
              alt=""
              draggable={false}
              className="absolute max-w-none select-none"
              style={{
                left: (stage.width - imageSize.width) / 2,
                top: (stage.height - imageSize.height) / 2,
                width: imageSize.width,
                height: imageSize.height,
                // Turns first, then the flips, then the free angle, as the engine applies them.
                transform: `rotate(${String(edit.angle)}deg)${edit.flipV ? ' scaleY(-1)' : ''}${edit.flip ? ' scaleX(-1)' : ''} rotate(${String(edit.turns * 90)}deg)`,
              }}
            />
            {blurPen && redact && (mode === 'blur' || redact.areas.length > 0) && (
              // Hidden areas sit on the image and turn with it; only blur mode takes the pointer.
              <div
                className={cn('absolute', mode !== 'blur' && 'pointer-events-none')}
                style={{
                  left: (stage.width - imageSize.width) / 2,
                  top: (stage.height - imageSize.height) / 2,
                  width: imageSize.width,
                  height: imageSize.height,
                  transform: `rotate(${String(edit.angle)}deg)${edit.flipV ? ' scaleY(-1)' : ''}${edit.flip ? ' scaleX(-1)' : ''} rotate(${String(edit.turns * 90)}deg)`,
                }}
              >
                <BlurLayer
                  src={src}
                  natural={natural}
                  redact={redact}
                  pen={blurPen}
                  active={mode === 'blur'}
                  onRedact={(next, transient) => {
                    onEdit({ ...edit, redact: next }, transient);
                  }}
                />
              </div>
            )}
            {pen && (mode === 'draw' || marks.length > 0) && (
              // Marks sit on the image and turn with it; only draw mode takes the pointer.
              <div
                className={cn('absolute', mode !== 'draw' && 'pointer-events-none')}
                style={{
                  left: (stage.width - imageSize.width) / 2,
                  top: (stage.height - imageSize.height) / 2,
                  width: imageSize.width,
                  height: imageSize.height,
                  transform: `rotate(${String(edit.angle)}deg)${edit.flipV ? ' scaleY(-1)' : ''}${edit.flip ? ' scaleX(-1)' : ''} rotate(${String(edit.turns * 90)}deg)`,
                }}
              >
                <DrawLayer
                  natural={natural}
                  marks={marks}
                  style={pen}
                  onMarks={(next, transient) => {
                    onEdit({ ...edit, marks: next }, transient);
                  }}
                />
              </div>
            )}
            {(mode === 'text' || texts.length > 0) && (
              // Text sits on the image and turns with it; only text mode takes the pointer.
              <div
                className={cn('absolute', mode !== 'text' && 'pointer-events-none')}
                style={{
                  left: (stage.width - imageSize.width) / 2,
                  top: (stage.height - imageSize.height) / 2,
                  width: imageSize.width,
                  height: imageSize.height,
                  transform: `rotate(${String(edit.angle)}deg)${edit.flipV ? ' scaleY(-1)' : ''}${edit.flip ? ' scaleX(-1)' : ''} rotate(${String(edit.turns * 90)}deg)`,
                }}
              >
                <TextLayers
                  natural={natural}
                  layers={texts}
                  selected={mode === 'text' ? selectedText : null}
                  onSelect={setSelectedText}
                  onLayers={(next, transient) => {
                    onEdit({ ...edit, texts: next }, transient);
                  }}
                />
              </div>
            )}
            {mode === 'straighten' && (
              // A grid to line the horizon or a wall up against.
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_srgb,var(--media-text)_45%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--media-text)_45%,transparent)_1px,transparent_1px)] bg-size-[12.5%_12.5%]"
              />
            )}
            {mode === 'crop' && box && (
              <div
                role="group"
                tabIndex={0}
                aria-label={`Crop box, ${boxLabel(box)}, at ${String(box.x)}, ${String(box.y)}`}
                aria-describedby={hintId}
                onKeyDown={onBoxKey}
                {...pointer}
                className="absolute cursor-move touch-none border border-media-text shadow-[0_0_0_100vmax_color-mix(in_srgb,var(--media-scrim)_55%,transparent)] outline-offset-4"
                style={{
                  left: box.x * fit,
                  top: box.y * fit,
                  width: box.width * fit,
                  height: box.height * fit,
                }}
              >
                <span id={hintId} className="sr-only">
                  Arrow keys move the box, Shift moves 10 px. Width, height and position are also in
                  the settings.
                </span>
                {/* Thirds lines. */}
                <span aria-hidden="true" className="pointer-events-none absolute inset-0">
                  {['left-1/3', 'left-2/3'].map((pos) => (
                    <span
                      key={pos}
                      className={cn('absolute inset-y-0 w-px bg-media-text/40', pos)}
                    />
                  ))}
                  {['top-1/3', 'top-2/3'].map((pos) => (
                    <span
                      key={pos}
                      className={cn('absolute inset-x-0 h-px bg-media-text/40', pos)}
                    />
                  ))}
                </span>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1.5 left-1.5 rounded-control bg-media-scrim/75 px-1.5 py-1 font-mono text-11 leading-none text-media-text"
                >
                  {boxLabel(box)}
                </span>
                {HANDLES.map((handle) => (
                  <span
                    key={handle.id}
                    aria-hidden="true"
                    data-handle={handle.id}
                    {...pointer}
                    className={cn(
                      'absolute flex size-8 touch-none items-center justify-center',
                      handle.className,
                      handle.cursor,
                    )}
                  >
                    <span
                      className={cn(
                        'block bg-media-text shadow-[0_0_0_1px_var(--media-scrim)]',
                        handle.id.length === 2
                          ? 'size-2.5'
                          : handle.id === 'n' || handle.id === 's'
                            ? 'h-1 w-4'
                            : 'h-4 w-1',
                      )}
                    />
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function IconButton({
  label,
  children,
  disabled,
  onClick,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-11 flex-none items-center justify-center text-text-muted hover:text-text disabled:opacity-38"
    >
      {children}
    </button>
  );
}
