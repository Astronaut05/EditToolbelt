import { describe, expect, it } from 'vitest';

import { renameAll, RenameInPlaceError, undoRenames, zipLimit, type MovableFile } from './in-place';

/** A folder that ignores case, like Windows and macOS, and refuses to overwrite. */
function folder(names: string[], failOn?: string) {
  const files = new Set(names.map((n) => n.toLowerCase()));
  const handles = names.map((start) => {
    const handle: MovableFile & { name: string } = {
      name: start,
      async move(to: string) {
        await Promise.resolve();
        if (to === failOn) throw new Error('disk full');
        if (files.has(to.toLowerCase()) && to.toLowerCase() !== handle.name.toLowerCase()) {
          throw new Error(`${to} exists`);
        }
        files.delete(handle.name.toLowerCase());
        files.add(to.toLowerCase());
        handle.name = to;
      },
    };
    return handle;
  });
  return { handles, names: () => handles.map((h) => h.name) };
}

describe('renameAll', () => {
  it('swaps names and changes case without a clash', async () => {
    const f = folder(['a.jpg', 'b.jpg', 'c.jpg']);
    const [a, b, c] = f.handles;
    if (!a || !b || !c) throw new Error('no handles');
    const done = await renameAll([
      { handle: a, to: 'b.jpg' },
      { handle: b, to: 'a.jpg' },
      { handle: c, to: 'C.jpg' },
    ]);
    expect(f.names()).toEqual(['b.jpg', 'a.jpg', 'C.jpg']);
    expect(done.map((d) => [d.from, d.to])).toEqual([
      ['a.jpg', 'b.jpg'],
      ['b.jpg', 'a.jpg'],
      ['c.jpg', 'C.jpg'],
    ]);
    await undoRenames(done);
    expect(f.names()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('puts everything back when a move fails', async () => {
    const f = folder(['a.jpg', 'b.jpg'], 'y.jpg');
    const [a, b] = f.handles;
    if (!a || !b) throw new Error('no handles');
    await expect(
      renameAll([
        { handle: a, to: 'x.jpg' },
        { handle: b, to: 'y.jpg' },
      ]),
    ).rejects.toThrow(RenameInPlaceError);
    expect(f.names()).toEqual(['a.jpg', 'b.jpg']);
  });

  it('leaves files whose name stays as it is', async () => {
    const f = folder(['a.jpg']);
    const [a] = f.handles;
    if (!a) throw new Error('no handles');
    expect(await renameAll([{ handle: a, to: 'a.jpg' }])).toEqual([]);
  });
});

describe('zipLimit', () => {
  const GB = 1024 ** 3;

  it('lets files that fit in a ZIP through', () => {
    expect(zipLimit(2 * GB, 2 * GB, false)).toBeUndefined();
    expect(zipLimit(0, 2 * GB, true)).toBeUndefined();
  });

  it('says how big the files are, and where they can be renamed instead', () => {
    expect(zipLimit(2 * GB + 1, 2 * GB, false)).toBe(
      'These files come to 2.1 GB, and a ZIP made in the browser holds up to 2 GB. Rename them where they are in Chrome or Edge on a computer, or choose fewer files.',
    );
    expect(zipLimit(5.24 * GB, 2 * GB, true)).toBe(
      'These files come to 5.3 GB, and a ZIP made in the browser holds up to 2 GB. Start over and open their folder to rename them where they are, or choose fewer files.',
    );
  });
});
