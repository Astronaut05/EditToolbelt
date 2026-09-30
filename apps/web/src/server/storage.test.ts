import { describe, expect, it } from 'vitest';

import { completeBody, StorageError } from './storage';

describe('completeBody', () => {
  it('lists parts in order with quoted, escaped ETags', () => {
    expect(
      completeBody([
        { n: 2, etag: 'bbb' },
        { n: 1, etag: '"aaa-2"' },
      ]),
    ).toBe(
      '<CompleteMultipartUpload>' +
        '<Part><PartNumber>1</PartNumber><ETag>&quot;aaa-2&quot;</ETag></Part>' +
        '<Part><PartNumber>2</PartNumber><ETag>&quot;bbb&quot;</ETag></Part>' +
        '</CompleteMultipartUpload>',
    );
  });

  it('refuses an ETag that could smuggle XML', () => {
    expect(() => completeBody([{ n: 1, etag: '"a"</ETag><x>' }])).toThrow(StorageError);
  });
});
