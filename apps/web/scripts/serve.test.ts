import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contentType, headersFor, parseHeaders, pickEncoding, resolveFile } from './serve';

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

describe('_headers', () => {
  const rules = parseHeaders(`# comment
/*
  X-Content-Type-Options: nosniff
  Content-Security-Policy: frame-ancestors 'none'

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

/video-converter
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp

/blog/:slug
  X-Blog: 1
  ! X-Content-Type-Options

/video-converter
  Content-Security-Policy: sandbox
`);

  it('applies every matching rule and joins repeated headers', () => {
    expect(headersFor('/video-converter', rules)).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "frame-ancestors 'none', sandbox",
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
  });

  it('matches splats, placeholders and ignores the query', () => {
    expect(headersFor('/_next/static/chunks/a.js?v=1', rules)['Cache-Control']).toContain(
      'immutable',
    );
    expect(headersFor('/photo', rules)['Cross-Origin-Embedder-Policy']).toBeUndefined();
    expect(
      headersFor('/video-converter/extra', rules)['Cross-Origin-Embedder-Policy'],
    ).toBeUndefined();
  });

  it('detaches headers with !', () => {
    const blog = headersFor('/blog/post', rules);
    expect(blog['X-Blog']).toBe('1');
    expect(blog['X-Content-Type-Options']).toBeUndefined();
    expect(headersFor('/blog/a/b', rules)['X-Blog']).toBeUndefined();
  });
});

describe('compression', () => {
  it('prefers Brotli, then gzip, and honours q=0', () => {
    expect(pickEncoding('gzip, deflate, br, zstd')).toBe('br');
    expect(pickEncoding('gzip')).toBe('gzip');
    expect(pickEncoding('br;q=0, gzip;q=1.0')).toBe('gzip');
    expect(pickEncoding(undefined)).toBeNull();
    expect(pickEncoding('identity')).toBeNull();
  });
});
