/**
 * "Use in another tool" (docs/02 → Result panel): the result goes to the next
 * tool in memory, without a re-upload. The file waits here, in this module,
 * across a client-side navigation; the next tool's shell takes it on mount.
 * A full page load starts empty, which is fine: nothing is ever stored.
 */

interface Pending {
  file: File;
  to: string;
  at: number;
}

let pending: Pending | null = null;

/** How long a handed-off file waits for its tool to open. */
const WAIT_MS = 30_000;

/** Whether a tool that accepts these types takes this file ("image/*" matches any image). */
export function accepts(types: readonly string[] | undefined, mime: string): boolean {
  if (!types || !mime) return false;
  return types.some(
    (type) => type === mime || (type.endsWith('/*') && mime.startsWith(type.slice(0, -1))),
  );
}

export function handOff(file: File, to: string, now = Date.now()): void {
  pending = { file, to, at: now };
}

/** The file handed to this tool, once; null if there is none or it waited too long. */
export function takeHandoff(toolId: string, now = Date.now()): File | null {
  const current = pending;
  if (!current || current.to !== toolId) return null;
  pending = null;
  return now - current.at <= WAIT_MS ? current.file : null;
}
