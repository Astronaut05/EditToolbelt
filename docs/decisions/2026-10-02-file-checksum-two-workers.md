# 2026-10-02 · File Checksum hashes in two workers, kept between files

**Decision:**
- **Two workers for each file.** One reads the file, once, hashes MD5 and SHA-1, and hands each piece to the other (transferred, not copied), which hashes SHA-256. The reader waits when it is 16 MB ahead, so pieces never pile up in memory behind a slow SHA-256.
- **The workers are kept between the files of a batch**, and let go after 10 s idle. An abort or error ends them.
- **The 48 MB e2e test hands its file over from disk** (a temporary folder), not as a buffer. Its 30 s timeout is unchanged.

**Why:** the test took 17–20 s alone and hit its timeout under load. Timed in the page, about 17 s went by before the input's change event even fired: Playwright sends a buffer as base64, and its code in the page decodes it with `Uint8Array.from(atob(…), c => c.charCodeAt(0))`, one callback per byte (7.9 s for 48 MB on its own in this Chromium, more with two tests running). The tool took about 1 s of it. Handed over from disk, the test takes about 4 s. The folder name is plain ASCII: `testInfo.outputPath` would put the test title's ’ in the path, and Chromium under a POSIX locale doesn't open it.
In the tool itself, all three hashes ran one after another in one worker: 70 to 90 MB/s in Chromium (hash-wasm alone: MD5 430, SHA-1 330, SHA-256 180 MB/s). Split in two, a file goes at about SHA-256's pace: 48 MB took 630–720 ms before and 330–430 ms after, interleaved in the same browser. Each file also started a new worker and compiled its WebAssembly again: 50 small files took 1.4–1.7 s in the engine, now 0.11–0.15 s. Web Crypto stays out: it has no MD5, can't hash a stream, and its SHA-256 ran at 120 MB/s here, slower than hash-wasm.
**Reverse:** one group with all three hashes in `GROUPS` (`packages/engines/src/files/checksum.ts`) is one worker again; without `takeTeam` and `giveBack`, each file starts its own workers.
