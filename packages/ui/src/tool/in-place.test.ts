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

/**
 * A folder that keeps what each name holds. A handle is a name, as on disk: a
 * move takes whatever is under it. A move onto a taken name fails, or with
 * `overwrite` replaces that file. `refuse` picks more moves to fail.
 */
function disk(
  names: string[],
  overwrite: boolean,
  refuse: (from: string, to: string) => boolean = () => false,
) {
  const files = new Map(names.map((name) => [name, `data of ${name}`]));
  const handles = names.map((start) => {
    const handle: MovableFile & { name: string } = {
      name: start,
      async move(to: string) {
        await Promise.resolve();
        const data = files.get(handle.name);
        if (data === undefined) throw new Error('not found');
        if (refuse(handle.name, to)) throw new Error('disk full');
        if (files.has(to) && !overwrite) throw new Error('name taken');
        files.delete(handle.name);
        files.set(to, data);
        handle.name = to;
      },
    };
    return handle;
  });
  return { handles, files: () => Object.fromEntries(files) };
}

/** a → b, b → c, c → d: every new name but the last is another file's old one. */
function shift(handles: MovableFile[]) {
  return handles.map((handle, i) => ({ handle, to: ['b.jpg', 'c.jpg', 'd.jpg'][i] ?? '' }));
}

const SHIFTED = ['a.jpg', 'b.jpg', 'c.jpg'];
const UNTOUCHED = {
  'a.jpg': 'data of a.jpg',
  'b.jpg': 'data of b.jpg',
  'c.jpg': 'data of c.jpg',
};
const isTemp = (name: string) => name.startsWith('.etb-rename-');

describe('renameAll', () => {
  it.each([
    ['fails', false],
    ['overwrites', true],
  ])(
    'puts shifted names back when the last move fails (a move onto a taken name %s)',
    async (_, overwrite) => {
      const d = disk(SHIFTED, overwrite, (_from, to) => to === 'd.jpg');
      const failed = await renameAll(shift(d.handles)).catch((error: unknown) => error);
      expect(failed).toBeInstanceOf(RenameInPlaceError);
      expect((failed as Error).message).toBe('A file couldn’t be renamed, so none were: disk full');
      expect(d.files()).toEqual(UNTOUCHED);
      expect(d.handles.map((h) => h.name)).toEqual(SHIFTED);
    },
  );

  it.each([
    ['fails', false],
    ['overwrites', true],
  ])(
    'names a file that couldn’t go back to its old name (a move onto a taken name %s)',
    async (_, overwrite) => {
      let goingBack = false;
      const d = disk(SHIFTED, overwrite, (from, to) => {
        if (to === 'd.jpg') goingBack = true;
        return to === 'd.jpg' || (goingBack && isTemp(from) && to === 'b.jpg');
      });
      const failed = await renameAll(shift(d.handles)).catch((error: unknown) => error);
      expect(failed).toBeInstanceOf(RenameInPlaceError);
      const message = (failed as Error).message;
      const [, b] = d.handles;
      expect(b && isTemp(b.name)).toBe(true);
      expect(message).toBe(
        `A file couldn’t be renamed, and not every file could be put back: “b.jpg” is now “${b?.name ?? ''}”. The other files are named as before. The error: disk full`,
      );
      expect(d.files()).toEqual({
        'a.jpg': 'data of a.jpg',
        [b?.name ?? '']: 'data of b.jpg',
        'c.jpg': 'data of c.jpg',
      });
    },
  );

  it.each([
    ['fails', false],
    ['overwrites', true],
  ])(
    'keeps a file that is stuck on its new name, and the file whose name it holds (a move onto a taken name %s)',
    async (_, overwrite) => {
      let goingBack = false;
      const d = disk(SHIFTED, overwrite, (from, to) => {
        if (to === 'd.jpg') goingBack = true;
        // The first file, now b.jpg, can't be moved again.
        return to === 'd.jpg' || (goingBack && from === 'b.jpg');
      });
      const failed = await renameAll(shift(d.handles)).catch((error: unknown) => error);
      expect(failed).toBeInstanceOf(RenameInPlaceError);
      const message = (failed as Error).message;
      const [, b] = d.handles;
      expect(b && isTemp(b.name)).toBe(true);
      expect(message).toContain('“a.jpg” is now “b.jpg”');
      expect(message).toContain(`“b.jpg” is now “${b?.name ?? ''}”`);
      expect(message).not.toContain('“c.jpg”');
      expect(d.files()).toEqual({
        'b.jpg': 'data of a.jpg',
        [b?.name ?? '']: 'data of b.jpg',
        'c.jpg': 'data of c.jpg',
      });
    },
  );

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
