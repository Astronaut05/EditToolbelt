# 2026-10-01 · File Checksum (Wave 3)

**Decision:**
- **hash-wasm** (MIT, `docs/13`) hashes in a worker. One read of the file feeds MD5, SHA-1 and SHA-256 at once, a piece at a time, so a 30 GB clip never sits in memory. Web Crypto can't hash a stream, so it would need the whole file at once.
- **New engine id `file-hash`**, which loads WebAssembly. U04 isn't `text`, the engine for pure-TypeScript work.
- **One file or many, the page is a batch list:** it runs as soon as files are in, and each row shows its three hashes with copy buttons. Up to 1,000 files, 32 GB each.
- **Expected hash** takes one hash, or a list in `sha256sum` style (`<hash>  <name>`, `*` for binary mode) or BSD style (`SHA256 (<name>) = <hash>`). The algorithm is told by the hash's length. Files are matched to a list by name, without folders and ignoring case. Checking a pasted hash never re-reads the files.
- **Two or more files without a pasted hash are compared:** "The 2 files are identical / different", or how many are copies of another.
- **The download is the list, not a ZIP of one-line files:** SHA256SUMS, MD5SUMS or SHA1SUMS (checkable with `sha256sum -c` or `shasum -a 256 -c`), or a CSV with all three. In the CSV, a name a spreadsheet would run as a formula gets a leading `'`.

**Why:** `tools/utility.md` → U04.
**Reverse:** the logic is in `packages/core/src/checksum.ts`; the engine is `packages/engines/src/files/checksum.ts`; the ToolShell's `batchCheck`, `batchSummary` and `batchList` are only used here.
