/**
 * U02: renaming files where they are, in a folder the user opened (File
 * System Access, desktop Chromium). Every file is first moved to a temporary
 * name, then to its new one, so names that swap or only change case never
 * meet. If a move fails, the files moved so far go back. The moves that were
 * made are kept, so the whole rename can be undone while the page is open.
 */

/** The part of a file handle a rename needs (a real handle, or a test's). */
export interface MovableFile {
  readonly name: string;
  move(name: string): Promise<void>;
}

export interface Renamed {
  handle: MovableFile;
  from: string;
  to: string;
}

export class RenameInPlaceError extends Error {}

/** Whether this browser can rename files in a folder it opened. */
export function canRenameInPlace(): boolean {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) return false;
  const proto = (globalThis as { FileSystemFileHandle?: { prototype: object } })
    .FileSystemFileHandle?.prototype;
  return Boolean(proto && 'move' in proto);
}

const tempName = (index: number, stamp: string) => `.etb-rename-${stamp}-${String(index)}.tmp`;

/** Each `from` → `to`, in two steps; the list of what was done, or an error with everything put back. */
export async function renameAll(
  pairs: readonly { handle: MovableFile; to: string }[],
  progress?: (fraction: number) => void,
): Promise<Renamed[]> {
  const stamp = Date.now().toString(36);
  const steps = pairs.filter((pair) => pair.handle.name !== pair.to);
  const moved: { handle: MovableFile; from: string; at: string }[] = [];
  const total = steps.length * 2 || 1;
  let done = 0;
  try {
    for (const [index, pair] of steps.entries()) {
      const from = pair.handle.name;
      const at = tempName(index, stamp);
      await pair.handle.move(at);
      moved.push({ handle: pair.handle, from, at });
      progress?.((done += 1) / total);
    }
    for (const [index, pair] of steps.entries()) {
      await pair.handle.move(pair.to);
      const step = moved[index];
      if (step) step.at = pair.to;
      progress?.((done += 1) / total);
    }
  } catch (error) {
    // Put back what moved, newest first; a file that can't go back keeps its temporary name.
    for (const step of moved.reverse()) {
      try {
        await step.handle.move(step.from);
      } catch {
        // Reported below with the first error.
      }
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new RenameInPlaceError(`A file couldn’t be renamed, so none were: ${reason}`);
  }
  return moved.map((step) => ({ handle: step.handle, from: step.from, to: step.at }));
}

/** Puts every renamed file back, also in two steps. */
export function undoRenames(renamed: readonly Renamed[]): Promise<Renamed[]> {
  return renameAll(renamed.map((item) => ({ handle: item.handle, to: item.from })));
}
