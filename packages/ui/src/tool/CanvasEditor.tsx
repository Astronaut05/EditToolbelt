'use client';

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
import { useState, type ReactNode } from 'react';

import { cn } from '../cn';

export type EditorMode = 'crop' | 'resize' | 'rotate' | 'flip' | 'draw' | 'text' | 'blur';

const MODES: { id: EditorMode; label: string; icon: ReactNode }[] = [
  { id: 'crop', label: 'Crop', icon: <Crop size={16} strokeWidth={1.75} aria-hidden="true" /> },
  {
    id: 'resize',
    label: 'Resize',
    icon: <Scaling size={16} strokeWidth={1.75} aria-hidden="true" />,
  },
  {
    id: 'rotate',
    label: 'Rotate',
    icon: <RotateCw size={16} strokeWidth={1.75} aria-hidden="true" />,
  },
  {
    id: 'flip',
    label: 'Flip',
    icon: <FlipHorizontal2 size={16} strokeWidth={1.75} aria-hidden="true" />,
  },
  {
    id: 'draw',
    label: 'Draw',
    icon: <Highlighter size={16} strokeWidth={1.75} aria-hidden="true" />,
  },
  { id: 'text', label: 'Text', icon: <Type size={16} strokeWidth={1.75} aria-hidden="true" /> },
  { id: 'blur', label: 'Blur', icon: <Waves size={16} strokeWidth={1.75} aria-hidden="true" /> },
];

interface View {
  rotate: number;
  flip: boolean;
}

const HISTORY_LIMIT = 50;

/**
 * The shared photo editor shell (docs/03 → CanvasEditor). M1 ships the frame:
 * mode toolbar (the preset opens one mode, the rest one tap away), 50-step
 * undo/redo, zoom, and rotate/flip applied to the view. The pixel work arrives
 * with the image engines in M2.
 */
export function CanvasEditor({
  image,
  initialMode = 'crop',
  enabledModes,
  className,
}: {
  image: ReactNode;
  initialMode?: EditorMode;
  /** Modes the preset shows; all by default. */
  enabledModes?: EditorMode[];
  className?: string;
}) {
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [zoom, setZoom] = useState(100);
  const [history, setHistory] = useState<View[]>([{ rotate: 0, flip: false }]);
  const [cursor, setCursor] = useState(0);
  const view = history[cursor] ?? { rotate: 0, flip: false };
  const modes = MODES.filter((m) => !enabledModes || enabledModes.includes(m.id));

  function commit(next: View) {
    const kept = history.slice(Math.max(0, cursor + 1 - HISTORY_LIMIT + 1), cursor + 1);
    setHistory([...kept, next]);
    setCursor(kept.length);
  }

  function pick(next: EditorMode) {
    setMode(next);
    if (next === 'rotate') commit({ ...view, rotate: (view.rotate + 90) % 360 });
    if (next === 'flip') commit({ ...view, flip: !view.flip });
  }

  return (
    <div className={cn('absolute inset-0 flex flex-col bg-surface', className)}>
      <div
        role="toolbar"
        aria-label="Editor"
        className="flex h-12 items-center gap-1 overflow-x-auto border-b border-border bg-bg px-3"
      >
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => {
              pick(m.id);
            }}
            className={cn(
              'inline-flex h-11 items-center gap-2 px-2.5 text-14',
              mode === m.id ? 'font-strong text-text' : 'text-text-muted hover:text-text',
            )}
          >
            {m.icon}
            <span className={cn(mode === m.id && 'underline-accent')}>{m.label}</span>
          </button>
        ))}
        <span aria-hidden="true" className="mx-2 h-5 w-px bg-border" />
        <IconButton
          label="Undo"
          disabled={cursor === 0}
          onClick={() => {
            setCursor(cursor - 1);
          }}
        >
          <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Redo"
          disabled={cursor >= history.length - 1}
          onClick={() => {
            setCursor(cursor + 1);
          }}
        >
          <Redo2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
        <span className="ml-auto flex items-center gap-1">
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
      <div className="relative flex-1 overflow-hidden">
        <div
          className="absolute inset-8 transition-transform duration-(--dur) ease-signal"
          style={{
            transform: `scale(${String(zoom / 100)}) rotate(${String(view.rotate)}deg) scaleX(${view.flip ? -1 : 1})`,
          }}
        >
          {image}
          {mode === 'crop' && (
            <div
              aria-hidden="true"
              className="absolute inset-[12%] border border-media-text shadow-[0_0_0_100vmax_color-mix(in_srgb,var(--media-scrim)_55%,transparent)]"
            >
              {['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'].map(
                (pos) => (
                  <span key={pos} className={cn('absolute size-2.5 bg-media-text', pos)} />
                ),
              )}
            </div>
          )}
        </div>
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
      className="inline-flex size-11 items-center justify-center text-text-muted hover:text-text disabled:opacity-38"
    >
      {children}
    </button>
  );
}
