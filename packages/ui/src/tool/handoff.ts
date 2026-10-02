/**
 * "Use in another tool" (docs/02 → Result panel): the result goes to the next
 * tool in memory, without a re-upload. The file waits here, in this module,
 * across a client-side navigation; the next tool's shell takes it on mount.
 * A full page load starts empty, which is fine: nothing is ever stored.
 * M8's Android share target hands files on the same way, several at once.
 */

interface Pending {
  files: File[];
  to: string;
  at: number;
}

let pending: Pending | null = null;

/** How long a handed-off file waits for its tool to open. */
const WAIT_MS = 30_000;

/**
 * Whether a tool that accepts these types takes this file: by MIME type
 * ("image/*" matches any image) or by extension (".srt").
 */
export function accepts(
  types: readonly string[] | undefined,
  file: { type: string; name: string },
): boolean {
  if (!types) return false;
  const mime = file.type.split(';')[0]?.trim() ?? '';
  const name = file.name.toLowerCase();
  return types.some((type) =>
    type.startsWith('.')
      ? name.endsWith(type)
      : mime !== '' &&
        (type === mime || (type.endsWith('/*') && mime.startsWith(type.slice(0, -1)))),
  );
}

export function handOff(file: File | File[], to: string, now = Date.now()): void {
  pending = { files: Array.isArray(file) ? file : [file], to, at: now };
}

/** The files handed to this tool, once; null if there are none or they waited too long. */
export function takeHandoff(toolId: string, now = Date.now()): File[] | null {
  const current = pending;
  if (!current || current.to !== toolId) return null;
  pending = null;
  return now - current.at <= WAIT_MS && current.files.length > 0 ? current.files : null;
}
