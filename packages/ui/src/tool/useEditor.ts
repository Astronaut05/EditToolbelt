'use client';

import { turnedSize, type Size } from '@etb/engines';
import { useCallback, useMemo, useRef, useState } from 'react';

import { fitBox, NO_EDIT, type Edit } from './crop';

/** Undo keeps this many steps (docs/03 → CanvasEditor). */
const HISTORY_LIMIT = 50;

interface History {
  past: Edit[];
  present: Edit;
  future: Edit[];
  /** The edit before a drag started; a drag is one undo step. */
  dragFrom: Edit | null;
}

const fresh = (edit: Edit = NO_EDIT): History => ({
  past: [],
  present: edit,
  future: [],
  dragFrom: null,
});

function commit(history: History, next: Edit): History {
  const before = history.dragFrom ?? history.present;
  if (JSON.stringify(before) === JSON.stringify(next))
    return { ...history, present: next, dragFrom: null };
  return {
    past: [...history.past, before].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    dragFrom: null,
  };
}

export interface EditorState {
  edit: Edit;
  /** A transient edit (mid-drag) updates the view; the next committed one makes it one undo step. */
  onEdit: (next: Edit, transient?: boolean) => void;
  /** The image's own size, before turns; null until it has loaded. */
  natural: Size | null;
  onNatural: (size: Size) => void;
  /** The crop ratio changed in the settings: refit the box. */
  applyRatio: (ratio: number | null) => void;
  reset: () => void;
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
}

/** The CanvasEditor's state and its undo history, owned by the page (the ToolShell). */
export function useEditor(initialRatio: number | null): EditorState {
  const [history, setHistory] = useState<History>(fresh);
  const [natural, setNatural] = useState<Size | null>(null);
  const ratio = useRef(initialRatio);
  const size = useRef<Size | null>(null);

  const onEdit = useCallback((next: Edit, transient = false) => {
    setHistory((h) =>
      transient ? { ...h, present: next, dragFrom: h.dragFrom ?? h.present } : commit(h, next),
    );
  }, []);

  const onNatural = useCallback((next: Size) => {
    size.current = next;
    setNatural(next);
    // The first box: the whole image, or the largest box of the ratio.
    setHistory((h) =>
      h.present.crop
        ? h
        : fresh({ ...h.present, crop: fitBox(turnedSize(next, h.present.turns), ratio.current) }),
    );
  }, []);

  const applyRatio = useCallback((next: number | null) => {
    if (next === ratio.current) return;
    ratio.current = next;
    const image = size.current;
    if (!image) return;
    setHistory((h) =>
      commit(h, {
        ...h.present,
        crop: fitBox(turnedSize(image, h.present.turns), next, h.present.crop),
      }),
    );
  }, []);

  const reset = useCallback(() => {
    size.current = null;
    setNatural(null);
    setHistory(fresh());
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      const previous = h.past.at(-1);
      if (!previous) return h;
      return {
        past: h.past.slice(0, -1),
        present: previous,
        future: [h.present, ...h.future],
        dragFrom: null,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      const next = h.future[0];
      if (!next) return h;
      return {
        past: [...h.past, h.present],
        present: next,
        future: h.future.slice(1),
        dragFrom: null,
      };
    });
  }, []);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  return {
    edit: history.present,
    onEdit,
    natural,
    onNatural,
    applyRatio,
    reset,
    history: useMemo(() => ({ canUndo, canRedo, undo, redo }), [canUndo, canRedo, undo, redo]),
  };
}
