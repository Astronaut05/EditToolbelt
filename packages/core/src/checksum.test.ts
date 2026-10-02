import { describe, expect, it } from 'vitest';

import { algoOf, checkFile, checksumList, parseExpected } from './checksum';

const ABC = {
  md5: '900150983cd24fb0d6963f7d28e17f72',
  sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
};

describe('pasted hashes', () => {
  it('tells the algorithm by length, and rejects anything not hex', () => {
    expect(algoOf(ABC.md5)).toBe('md5');
    expect(algoOf(ABC.sha1.toUpperCase())).toBe('sha1');
    expect(algoOf(` ${ABC.sha256} `)).toBe('sha256');
    expect(algoOf('xyz')).toBeNull();
    expect(algoOf('abcd')).toBeNull();
  });

  it('reads a bare hash, sha256sum lines and BSD lines', () => {
    const parsed = parseExpected(
      [
        ABC.sha256.toUpperCase(),
        `${ABC.md5}  clips/A001.mov`,
        `${ABC.sha1} *B002.MXF`,
        `SHA256 (C003.wav) = ${ABC.sha256}`,
        '# a comment',
        'not a hash',
      ].join('\r\n'),
    );
    expect(parsed.bare).toEqual([ABC.sha256]);
    expect([...parsed.byName]).toEqual([
      ['a001.mov', ABC.md5],
      ['b002.mxf', ABC.sha1],
      ['c003.wav', ABC.sha256],
    ]);
  });
});

describe('checkFile', () => {
  it('checks a file against its line by name, or the one bare hash', () => {
    const list = parseExpected(`${ABC.md5}  A001.mov\n${'0'.repeat(64)}  B002.mov`);
    expect(checkFile('a001.MOV', ABC, list)).toEqual({ kind: 'match', algo: 'md5' });
    expect(checkFile('B002.mov', ABC, list)).toEqual({
      kind: 'mismatch',
      algo: 'sha256',
      expected: '0'.repeat(64),
    });
    expect(checkFile('C003.mov', ABC, list)).toEqual({ kind: 'missing' });
    expect(checkFile('any.bin', ABC, parseExpected(ABC.sha1))).toEqual({
      kind: 'match',
      algo: 'sha1',
    });
    expect(checkFile('any.bin', ABC, parseExpected(''))).toEqual({ kind: 'none' });
    // Two bare hashes and no names: nothing says which is which.
    expect(checkFile('any.bin', ABC, parseExpected(`${ABC.md5}\n${ABC.sha1}`))).toEqual({
      kind: 'none',
    });
  });
});

describe('checksumList', () => {
  const rows = [
    { name: 'abc.txt', size: 3, hashes: ABC },
    { name: 'say "hi".txt', size: 0, hashes: { sha256: 'e'.repeat(64) } },
  ];

  it('writes a list sha256sum -c can check', () => {
    expect(checksumList(rows, 'sha256')).toEqual({
      text: `${ABC.sha256}  abc.txt\n${'e'.repeat(64)}  say "hi".txt\n`,
      name: 'SHA256SUMS',
    });
    expect(checksumList(rows, 'md5').text).toBe(`${ABC.md5}  abc.txt\n`);
  });

  it('or a CSV with all three, names quoted', () => {
    const csv = checksumList(rows, 'csv');
    expect(csv.name).toBe('checksums.csv');
    expect(csv.text.split('\n')).toEqual([
      'file,bytes,md5,sha1,sha256',
      `"abc.txt",3,${ABC.md5},${ABC.sha1},${ABC.sha256}`,
      `"say ""hi"".txt",0,,,${'e'.repeat(64)}`,
      '',
    ]);
  });

  it('keeps a name a spreadsheet would run as a formula as text', () => {
    const csv = checksumList([{ name: '=HYPERLINK("x").mov', size: 1, hashes: {} }], 'csv');
    expect(csv.text.split('\n')[1]).toBe(`"'=HYPERLINK(""x"").mov",1,,,`);
  });
});
