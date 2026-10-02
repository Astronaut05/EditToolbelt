import type { NamesPlan } from '../files/batch-rename';
import { lazyEngine } from '../lazy';

/** U02 Batch Rename Files, before the engine loads. */
export const BATCH_RENAME_META = {
  capabilities: () => ({ supported: true }),
  estimate: () => ({ seconds: 0.1 }),
};

const load = () => import('../files/batch-rename');

export const batchRenameEngine = lazyEngine(
  () => load().then((m) => m.batchRenameEngine),
  BATCH_RENAME_META,
);

/** `renamePlan` (../files/batch-rename), loaded with the first files. */
export async function renamePlan(
  files: readonly File[],
  options: Record<string, string>,
  today?: Date,
): Promise<NamesPlan> {
  const loaded = await load();
  return loaded.renamePlan(files, options, today);
}
