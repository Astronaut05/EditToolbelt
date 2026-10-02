# BiRefNet-lite is pinned by SHA-256

**Decision:** Remove Background's Quality model (`rmbg/birefnet-lite-fp16.onnx`) is pinned to SHA-256 `d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402`, the file CI downloaded from `models.json`'s source on 2026-10-02 (114.5 MB). Every browser model now has a hash: `SegmentModel.sha256` is a string, no longer `string | null`, so a model can't be added without one. The source URL stays on the repository's `main` branch.

**Why:** It was the one model sent to users without a pinned hash: the browser skipped its check, and `pnpm models` saved whatever the branch served that day (final-pass audit). Hugging Face is blocked from the build environment, so its commit id couldn't be read to pin the URL as well. The hash does the same job, failing closed: if the branch ever serves another file, `pnpm models` refuses to save it (the production build stops, `--strict`), and the browser refuses a file that doesn't match. Quality mode then waits for a new pin, and Light mode keeps working.

**Reverse:** set the hash back to null in `packages/engines/src/image/rmbg/models.ts` (and the type to `string | null`). To move to a newer upload, run `pnpm models` where Hugging Face is reachable, check the file, and pin the hash it prints.
