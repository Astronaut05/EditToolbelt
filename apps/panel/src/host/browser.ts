/**
 * The panel in a browser: for working on its look and for its tests. There's
 * no timeline, so there's no selected clip; files come from a file picker,
 * results are downloaded, and the key is kept in localStorage.
 */
import { typeOf, type Host, type PickedFile } from './types';

export function fromBlob(file: Blob, name: string): PickedFile {
  return {
    name,
    size: file.size,
    type: file.type || typeOf(name),
    slice: (start, end) => Promise.resolve(file.slice(start, end)),
    text: () => file.text(),
  };
}

function download(data: Blob, name: string): void {
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

const PREFIX = 'etb-panel:';

export function browserHost(): Host {
  return {
    kind: 'browser',
    selectedMedia: () => Promise.resolve(null),
    pickFile: (extensions) =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = extensions.map((ext) => `.${ext}`).join(',');
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          resolve(file ? fromBlob(file, file.name) : null);
        });
        input.addEventListener('cancel', () => {
          resolve(null);
        });
        input.click();
      }),
    importResult: (data, name) => {
      download(data, name);
      return Promise.resolve(`Downloaded ${name}`);
    },
    saveFile: (data, name) => {
      download(data, name);
      return Promise.resolve(`Downloaded ${name}`);
    },
    openUrl: (url) => {
      window.open(url, '_blank', 'noopener');
      return Promise.resolve();
    },
    readSecret: (key) => {
      try {
        return Promise.resolve(localStorage.getItem(PREFIX + key));
      } catch {
        return Promise.resolve(null);
      }
    },
    writeSecret: (key, value) => {
      try {
        if (value === null) localStorage.removeItem(PREFIX + key);
        else localStorage.setItem(PREFIX + key, value);
      } catch {
        // Private windows may refuse storage: the panel asks to connect again next time.
      }
      return Promise.resolve();
    },
  };
}
