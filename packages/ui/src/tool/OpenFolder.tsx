'use client';

/**
 * U02's way in for a folder: whether this browser can rename files where they
 * are, and the drop zone's button. They are all of U02 that the empty page
 * shows, so they load with it; the rest (./FolderRename: the names' checks,
 * the folder picker, renaming in place and undo) loads when files arrive or
 * the button is about to be used (docs/10 → Budgets: script transfer on a
 * tool page).
 */
import { FolderOpen } from 'lucide-react';

import { Button } from '../primitives/Button';

/** Whether this browser can rename files in a folder it opened. */
export function canRenameInPlace(): boolean {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) return false;
  const proto = (globalThis as { FileSystemFileHandle?: { prototype: object } })
    .FileSystemFileHandle?.prototype;
  return Boolean(proto && 'move' in proto);
}

/**
 * The drop zone's way in for a folder (desktop Chromium). `onIntent` fires as
 * the pointer or the keyboard reaches the button, so the picker's code is
 * there by the click: a browser opens the picker only straight after one.
 */
export function OpenFolderButton({
  onClick,
  onIntent,
}: {
  onClick: () => void;
  onIntent: () => void;
}) {
  return (
    <span onPointerEnter={onIntent} onFocus={onIntent}>
      <Button
        onClick={onClick}
        icon={<FolderOpen aria-hidden="true" size={18} strokeWidth={1.75} />}
      >
        Open a folder
      </Button>
    </span>
  );
}
