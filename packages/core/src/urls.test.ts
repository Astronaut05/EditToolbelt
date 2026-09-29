import { describe, expect, it } from 'vitest';

import { joinUrl } from './urls';

describe('joinUrl', () => {
  it.each([
    ['http://localhost:3000', '/tools/crop-image', 'http://localhost:3000/tools/crop-image'],
    ['http://localhost:3000/', 'tools/crop-image', 'http://localhost:3000/tools/crop-image'],
    ['http://localhost:3000', '/', 'http://localhost:3000/'],
    ['http://localhost:3000', '', 'http://localhost:3000/'],
    ['/models', 'birefnet/lite-fp16.onnx', '/models/birefnet/lite-fp16.onnx'],
    ['/models/', '/birefnet/lite-fp16.onnx', '/models/birefnet/lite-fp16.onnx'],
    [
      'https://models.example.com',
      'ffmpeg/core.wasm',
      'https://models.example.com/ffmpeg/core.wasm',
    ],
  ])('joinUrl(%s, %s) → %s', (base, path, expected) => {
    expect(joinUrl(base, path)).toBe(expected);
  });
});
