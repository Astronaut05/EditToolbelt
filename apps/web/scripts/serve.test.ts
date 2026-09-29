import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contentType, resolveFile } from './serve';

const root = resolve('/srv/out');
const files = new Set(
  [
    'index.html',
    'about.html',
    'tools/index.html',
    '404.html',
    '_next/static/app.js',
    'models/m.onnx',
  ].map((file) => join(root, file)),
);
const isFile = (path: string) => files.has(path);

describe('resolveFile', () => {
  it.each([
    ['/', 'index.html'],
    ['/about', 'about.html'],
    ['/about.html', 'about.html'],
    ['/tools', 'tools/index.html'],
    ['/tools/', 'tools/index.html'],
    ['/_next/static/app.js?v=1', '_next/static/app.js'],
    ['/models/m.onnx', 'models/m.onnx'],
    ['/%61bout', 'about.html'],
  ])('%s → %s', (url, file) => {
    expect(resolveFile(root, url, isFile)).toBe(join(root, file));
  });

  it.each(['/missing', '/../etc/passwd', '/..%2f..%2fetc/passwd', '/%E0%A4%A', '/a%00b'])(
    'refuses %s',
    (url) => {
      expect(resolveFile(root, url, isFile)).toBeNull();
    },
  );
});

describe('contentType', () => {
  it.each([
    ['a.html', 'text/html; charset=utf-8'],
    ['a.wasm', 'application/wasm'],
    ['a.JS', 'text/javascript; charset=utf-8'],
    ['a.unknown', 'application/octet-stream'],
  ])('%s → %s', (file, type) => {
    expect(contentType(file)).toBe(type);
  });
});
