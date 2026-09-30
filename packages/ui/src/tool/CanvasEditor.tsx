'use client';

import { turnedSize, type Size } from '@etb/engines';
import {
  Crop,
  FlipHorizontal2,
  Highlighter,
  Minus,
  Plus,
  Redo2,
  RotateCw,
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
import { boxLabel, dragHandle, moveBox, turnEdit, type Edit, type Handle } from './crop';
import type { EditorState } from './useEditor';

export type EditorMode = 'crop' | 'resize' | 'rotate' | 'flip' | 'draw' | 'text' | 'blur';

const icon = (Icon: typeof Crop) => <Icon size={16} strokeWidth={1.75} aria-hidden="true" />;

const MODES: { id: EditorMode; label: string; icon: ReactNode }[] = [
  { id: 'crop', label: 'Crop', icon: icon(Crop) },
  { id: 'resize', label: 'Resize', icon: icon(Scaling) },
  { id: 'rotate', label: 'Rotate 90°', icon: icon(RotateCw) },
  { id: 'flip', label: 'Flip', icon: icon(FlipHorizontal2) },
  { id: 'draw', label: 'Draw', icon: icon(Highlighter) },
  { id: 'text', label: 'Text', icon: icon(Type) },
  { id: 'blur', label: 'Blur', icon: icon(Waves) },
];

/** Rotate and flip act at once; the rest are modes. */
const ACTIONS: readonly EditorMode[] = ['rotate', 'flip'];

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
  className,
}: CanvasEditorProps) {
  const { edit, onEdit, natural, onNatural, history } = editor;
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [zoom, setZoom] = useState(100);
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
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
    else if (next === 'flip') onEdit({ ...edit, flip: !edit.flip });
    else setMode(next);
  }

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
                transform: `${edit.flip ? 'scaleX(-1) ' : ''}rotate(${String(edit.turns * 90)}deg)`,
              }}
            />
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

function IconButton({
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
