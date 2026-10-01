/**
 * The panel inside Premiere (UXP): the selected clip's media file, results
 * imported into a bin named "EditToolbelt", the key in UXP's secure storage.
 *
 * Written against Adobe's UXP and Premiere API references (`premierepro`,
 * `uxp`); this build environment has no Premiere, so it is checked in
 * Premiere 2026 at the stress test (docs/DECISIONS.md → Premiere panel). The
 * calls are kept here, behind `Host`, so a difference is a fix in one file.
 */
import { typeOf, type Host, type PickedFile } from './types';

// The small part of the UXP and Premiere APIs the panel uses.

interface UxpEntry {
  name: string;
  nativePath: string;
  read(options: { format: unknown }): Promise<ArrayBuffer | string>;
  write(data: ArrayBuffer | string, options?: { format: unknown }): Promise<unknown>;
  getMetadata?(): Promise<{ size: number }>;
}
interface UxpFolder {
  createFile(name: string, options: { overwrite: boolean }): Promise<UxpEntry>;
}
interface Uxp {
  storage: {
    formats: { binary: unknown; utf8: unknown };
    localFileSystem: {
      getEntryWithUrl(url: string): Promise<UxpEntry>;
      getFileForOpening(options: { types: string[] }): Promise<UxpEntry | null>;
      getFileForSaving(name: string, options: { types: string[] }): Promise<UxpEntry | null>;
      getDataFolder(): Promise<UxpFolder>;
    };
    secureStorage: {
      getItem(key: string): Promise<Uint8Array | string | null>;
      setItem(key: string, value: string): Promise<void>;
      removeItem(key: string): Promise<void>;
    };
  };
  shell: { openExternal(url: string): Promise<unknown> };
}
interface ProjectItem {
  name: string;
}
interface FolderItem extends ProjectItem {
  getItems(): Promise<ProjectItem[]>;
  createBinAction(name: string, makeUnique: boolean): unknown;
}
interface Project {
  getActiveSequence(): Promise<Sequence | null>;
  getRootItem(): Promise<FolderItem>;
  importFiles(
    paths: string[],
    suppressUI: boolean,
    target: FolderItem,
    asNumberedStills: boolean,
  ): Promise<boolean>;
  lockedAccess(callback: () => void): void;
  executeTransaction(
    callback: (compound: { addAction(action: unknown): void }) => void,
    undo: string,
  ): void;
}
interface Sequence {
  getSelection(): Promise<{
    getTrackItems(): Promise<{ getProjectItem(): Promise<ProjectItem> }[]>;
  }>;
}
interface Premiere {
  Project: { getActiveProject(): Promise<Project | null> };
  ClipProjectItem: { cast(item: ProjectItem): { getMediaFilePath(): Promise<string> } | null };
  FolderItem: { cast(item: ProjectItem): FolderItem | null };
}

/** The bin results go into (docs/06 → Panel-specific notes). */
export const BIN = 'EditToolbelt';

type Require = (id: string) => unknown;

/** Premiere's host, or null outside Premiere (a browser). */
export function premiereHost(): Host | null {
  const require = (globalThis as { require?: Require }).require;
  if (typeof require !== 'function') return null;
  let uxp: Uxp;
  let ppro: Premiere;
  try {
    uxp = require('uxp') as Uxp;
    ppro = require('premierepro') as Premiere;
  } catch {
    return null;
  }
  const { formats, localFileSystem, secureStorage } = uxp.storage;

  /** A file on disk, read once when first needed (UXP reads whole files). */
  function fromEntry(entry: UxpEntry, size: number, name = entry.name): PickedFile {
    let whole: Promise<Blob> | null = null;
    const blob = () => {
      whole ??= entry
        .read({ format: formats.binary })
        .then((data) => new Blob([data], { type: typeOf(name) }));
      return whole;
    };
    return {
      name,
      size,
      type: typeOf(name),
      slice: async (start, end) => (await blob()).slice(start, end),
      text: async () => (await blob()).text(),
    };
  }

  async function sizeOf(entry: UxpEntry): Promise<number> {
    if (entry.getMetadata) return (await entry.getMetadata()).size;
    return ((await entry.read({ format: formats.binary })) as ArrayBuffer).byteLength;
  }

  const fileUrl = (path: string) =>
    path.startsWith('/') ? `file:${path}` : `file:/${path.replaceAll('\\', '/')}`;

  async function bin(project: Project): Promise<FolderItem> {
    const find = async () => {
      const root = await project.getRootItem();
      for (const item of await root.getItems()) {
        if (item.name !== BIN) continue;
        const folder = ppro.FolderItem.cast(item);
        if (folder) return { root, folder };
      }
      return { root, folder: null };
    };
    const first = await find();
    if (first.folder) return first.folder;
    project.lockedAccess(() => {
      project.executeTransaction((compound) => {
        compound.addAction(first.root.createBinAction(BIN, false));
      }, `Add the ${BIN} bin`);
    });
    const made = await find();
    return made.folder ?? first.root;
  }

  return {
    kind: 'premiere',
    async selectedMedia() {
      const project = await ppro.Project.getActiveProject();
      const sequence = await project?.getActiveSequence();
      if (!sequence) return null;
      const items = await (await sequence.getSelection()).getTrackItems();
      for (const trackItem of items) {
        const projectItem = await trackItem.getProjectItem();
        const clip = ppro.ClipProjectItem.cast(projectItem);
        if (!clip) continue;
        const path = await clip.getMediaFilePath();
        if (!path) continue;
        const entry = await localFileSystem.getEntryWithUrl(fileUrl(path));
        const file = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
        return fromEntry(entry, await sizeOf(entry), file || projectItem.name);
      }
      return null;
    },
    async pickFile(extensions) {
      const entry = await localFileSystem.getFileForOpening({ types: extensions });
      return entry ? fromEntry(entry, await sizeOf(entry)) : null;
    },
    async importResult(data, name) {
      const folder = await localFileSystem.getDataFolder();
      const file = await folder.createFile(name, { overwrite: true });
      await file.write(await data.arrayBuffer(), { format: formats.binary });
      const project = await ppro.Project.getActiveProject();
      if (!project) return `Saved ${name} (open a project to import it)`;
      await project.importFiles([file.nativePath], true, await bin(project), false);
      return `Added ${name} to the ${BIN} bin`;
    },
    async saveFile(data, name) {
      const ext = name.slice(name.lastIndexOf('.') + 1);
      const entry = await localFileSystem.getFileForSaving(name, { types: [ext] });
      if (!entry) return null;
      await entry.write(await data.arrayBuffer(), { format: formats.binary });
      return `Saved ${entry.name}`;
    },
    async openUrl(url) {
      await uxp.shell.openExternal(url);
    },
    async readSecret(key) {
      const value = await secureStorage.getItem(key);
      if (value === null) return null;
      return typeof value === 'string' ? value : new TextDecoder().decode(value);
    },
    async writeSecret(key, value) {
      if (value === null) await secureStorage.removeItem(key);
      else await secureStorage.setItem(key, value);
    },
  };
}
