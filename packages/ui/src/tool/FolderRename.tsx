'use client';

/**
 * U02's part of the ToolShell: the new names' checks, the folder picker, and
 * renaming a folder's files where they are, with undo. The shell loads this
 * only for a preset with `names`, so other tool pages don't carry it
 * (docs/10 → Budgets: script transfer on a tool page).
 */
import type { NamesPlan } from '@etb/engines';
import { FolderOpen, Undo2 } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction } from 'react';

import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/overlays';
import type { BatchItem } from './BatchList';
import { plural } from './format';
import {
  canRenameInPlace,
  renameAll,
  RenameInPlaceError,
  undoRenames,
  zipLimit,
  type MovableFile,
  type Renamed,
} from './in-place';

export { canRenameInPlace };

/** A file in a folder the user opened: a handle that can be renamed, and its file. */
interface FolderFile extends MovableFile {
  getFile(): Promise<File>;
}

interface FolderHandle {
  name: string;
  values(): AsyncIterable<{ kind: string; name: string }>;
}

/** A folder the user opened: its name, and its files in name order. */
export interface Folder {
  name: string;
  handles: FolderFile[];
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Why the files can't be renamed yet, if they can't. `zip` is set for files
 * dropped, not a folder opened: they download renamed in a ZIP, which has a
 * size limit.
 */
export function namesBlocked(
  plan: NamesPlan | null,
  zip?: { bytes: number; maxBytes: number; inPlace: boolean },
): string | undefined {
  const full = zip && zipLimit(zip.bytes, zip.maxBytes, zip.inPlace);
  if (full) return full;
  if (!plan) return 'Reading the files…';
  if (plan.error) return plan.error;
  const unusable = plan.names.filter((name) => name.blocks).length;
  if (unusable > 0) {
    return `${plural(unusable, 'new name')} can’t be used: see the list. Change the rules until none are flagged.`;
  }
  return undefined;
}

/**
 * Opens a folder: `take` gets its files (not its subfolders or hidden files),
 * `fail` what to say when it has none. Nothing happens if the picker is closed.
 */
export async function openFolder(
  take: (files: File[], folder: Folder) => void,
  fail: (error: { label: string; title: string; body: string }) => void,
): Promise<void> {
  let dir: FolderHandle;
  try {
    dir = await (
      window as unknown as {
        showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<FolderHandle>;
      }
    ).showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return; // The picker was closed.
  }
  const handles: FolderFile[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && !entry.name.startsWith('.')) {
      handles.push(entry as unknown as FolderFile);
    }
  }
  handles.sort((a, b) => byName.compare(a.name, b.name));
  if (handles.length === 0) {
    fail({
      label: 'Empty folder',
      title: 'No files in this folder',
      body: 'Open a folder with files in it. Folders inside it are left as they are.',
    });
    return;
  }
  take(await Promise.all(handles.map((handle) => handle.getFile())), {
    name: dir.name,
    handles,
  });
}

/** The drop zone's way in for a folder (desktop Chromium). */
export function OpenFolderButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} icon={<FolderOpen aria-hidden="true" size={18} strokeWidth={1.75} />}>
      Open a folder
    </Button>
  );
}

/** What a rename in place changes in the shell: the list, the result and its analytics. */
export interface RenameHost {
  setBatch: Dispatch<SetStateAction<BatchItem[]>>;
  setBatchDone: (done: boolean) => void;
  setRenamed: (renamed: Renamed[] | null) => void;
  setError: (error: string | null) => void;
  track: (name: string, props?: Record<string, string>) => void;
}

/**
 * The primary action for an opened folder: rename its files (after a
 * confirm), then put the old names back.
 */
export function FolderAction({
  folder,
  plan,
  renamed,
  disabled,
  runLabel = 'Start',
  host,
}: {
  folder: Folder;
  plan: NamesPlan | null;
  renamed: Renamed[] | null;
  disabled: boolean;
  runLabel?: string;
  host: RenameHost;
}) {
  const [confirm, setConfirm] = useState(false);

  /** Every file in the folder gets its new name. */
  async function rename() {
    setConfirm(false);
    if (!plan) return;
    const pairs = folder.handles.map((handle, i) => ({
      handle,
      to: plan.names[i]?.to ?? handle.name,
    }));
    host.setError(null);
    host.setBatch((items) => items.map((item) => ({ ...item, status: 'running', progress: 0 })));
    host.track('tool_run_started', { path: 'client', files: String(pairs.length) });
    try {
      const done = await renameAll(pairs, (fraction) => {
        host.setBatch((items) => items.map((item) => ({ ...item, progress: fraction })));
      });
      host.setRenamed(done);
      host.setBatch((items) =>
        items.map((item) => ({ ...item, status: 'done', progress: undefined })),
      );
      host.setBatchDone(true);
    } catch (error) {
      host.setError(
        error instanceof RenameInPlaceError ? error.message : 'The files couldn’t be renamed.',
      );
      host.setBatch((items) =>
        items.map((item) => ({ ...item, status: 'queued', progress: undefined })),
      );
      host.track('tool_run_failed', { error_code: 'engine', engine_path: 'client' });
    }
  }

  /** The folder's files get their old names back. */
  async function undo() {
    if (!renamed) return;
    try {
      await undoRenames(renamed);
      host.setRenamed(null);
      host.setBatchDone(false);
      host.setBatch((items) => items.map((item) => ({ ...item, status: 'queued' })));
    } catch (error) {
      host.setError(error instanceof Error ? error.message : 'The old names couldn’t be put back.');
    }
  }

  if (renamed) {
    return (
      <Button
        variant="primary"
        className="flex-1"
        onClick={() => void undo()}
        icon={<Undo2 aria-hidden="true" size={18} strokeWidth={2} />}
      >
        Undo rename
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="primary"
        className="flex-1"
        disabled={disabled}
        onClick={() => {
          setConfirm(true);
        }}
      >
        {runLabel} in “{folder.name}”
      </Button>
      {confirm && (
        <Dialog
          open
          onClose={() => {
            setConfirm(false);
          }}
          title="Rename in the folder"
        >
          <p className="text-15.5 leading-body">
            {plural(
              plan?.names.filter((name, i) => name.to !== folder.handles[i]?.name).length ?? 0,
              'file',
            )}{' '}
            in “{folder.name}” get their new names.
          </p>
          <p className="mt-2 text-14 text-text-muted">
            Nothing else in the folder changes. Undo puts the old names back while this page is
            open.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => void rename()}>
              Rename
            </Button>
            <Button
              onClick={() => {
                setConfirm(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Under the actions: what went wrong, or what was renamed and how to undo it. */
export function RenameNotes({
  error,
  renamed,
  folder,
}: {
  error: string | null;
  renamed: Renamed[] | null;
  folder: Folder | null;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="mt-3.5 px-4 text-14 leading-body lg:px-0">
          {error}
        </p>
      )}
      {renamed && folder && (
        <p role="status" className="mt-3.5 px-4 text-14 leading-body text-text-muted lg:px-0">
          {plural(renamed.length, 'file')} renamed in “{folder.name}”. Undo puts the old names back
          while this page is open.
        </p>
      )}
    </>
  );
}
