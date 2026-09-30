import { describe, expect, it } from 'vitest';

import { pickedColorsEngine, readPicked, sampleColor } from './pick';

const ctx = { signal: new AbortController().signal, progress: () => undefined };

describe('color picker', () => {
  it('reads one pixel exactly', () => {
    expect(sampleColor([18, 52, 86, 255])).toEqual({
      hex: '#123456',
      rgb: 'rgb(18, 52, 86)',
      hsl: 'hsl(210, 65.4%, 20.4%)',
    });
  });

  it('averages a block in linear light, not in sRGB numbers', () => {
    // Half black, half white: the linear-light mean is 188, not 128.
    const block = [0, 0, 0, 255, 255, 255, 255, 255];
    expect(sampleColor(block).hex).toBe('#bcbcbc');
    // Transparent pixels don't count.
    expect(sampleColor([255, 0, 0, 255, 0, 0, 255, 0]).hex).toBe('#ff0000');
  });

  it('keeps only real HEX picks', () => {
    expect(readPicked('["#123456","nope",3,"#ABCDEF"]')).toEqual(['#123456', '#ABCDEF']);
    expect(readPicked('not json')).toEqual([]);
  });

  it('writes the picks oldest first, as CSS, JSON or ASE', async () => {
    const picked = JSON.stringify(['#abcdef', '#123456']);
    const css = await pickedColorsEngine.run(new Blob(), { picked }, ctx);
    expect(await css.blob.text()).toBe(
      ':root {\n  --picked-1: #123456;\n  --picked-2: #abcdef;\n}\n',
    );
    expect(css.notes).toEqual(['2 colors picked']);
    const json = await pickedColorsEngine.run(new Blob(), { picked, export: 'json' }, ctx);
    expect(JSON.parse(await json.blob.text())).toEqual([
      { hex: '#123456', rgb: 'rgb(18, 52, 86)', hsl: 'hsl(210, 65.4%, 20.4%)' },
      { hex: '#abcdef', rgb: 'rgb(171, 205, 239)', hsl: 'hsl(210, 68%, 80.4%)' },
    ]);
    const ase = await pickedColorsEngine.run(new Blob(), { picked, export: 'ase' }, ctx);
    expect(ase.ext).toBe('ase');
    const empty = await pickedColorsEngine.run(new Blob(), {}, ctx);
    expect(empty.notes).toEqual(['No colors picked yet']);
  });
});
