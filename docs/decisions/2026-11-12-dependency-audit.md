# 2026-11-12 · The dependency audit is cleared; Lighthouse stays at 13.5.0

**Decision:** every advisory `pnpm audit` listed on 2026-11-12 (35, three critical) is fixed by an update, and none is ignored:

- Shipped: Next 16.4.6 (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r), better-auth 1.7.20 (GHSA-965c-763c-88jm, GHSA-r4xp-prcw-77qf, GHSA-44jh-23m7-hpcf), nodemailer 10.5.0 (five advisories), zod 4.6.7 (GHSA-mrhx-c7xc-m3w5).
- Dev only: vitest 5.1.0, and Vite named in the root `package.json` at ^8.3.7. Vite is vitest's peer, so pnpm installs whichever release the lockfile already holds (8.3.1, six advisories), and neither `pnpm update` nor an override moves a peer.
- Dev only: `minimatch` 10 is overridden to ^11.0.1 in `pnpm-workspace.yaml` (GHSA-g3hv-75wg-m249). ESLint 10.14 still asks for ^10.2.6 and the 10 line has no fixed release; lint passes on 11.
- Dev only: Lighthouse stays at **13.5.0, pinned exactly**. Its zod advisory came through `puppeteer-core > chromium-bidi > zod 3`; the lockfile now holds puppeteer-core 25.17, whose chromium-bidi uses zod 4. Lighthouse 13.6.0 would fix the same thing but pulls `sentry` 0.49.0 (through `@sentry/node` 11), licensed FSL-1.1-Apache-2.0: not an open-source licence, so the licence check refuses it (`CLAUDE.md` rule 6).

The same CI job audits the Python side, which was red as well:

- Worker (`apps/worker/uv.lock`): aiohttp 3.14.5 (eight advisories in 3.14.3) and certifi 2026.10.23 (PYSEC-2026-4320), both under Modal's client.
- GPU images (`gpu/requirements-*.txt`, recompiled with hashes by the command at the top of each): **Pillow 13.0.0** (eight advisories in 12.3.0; 13.0.0 is the only fixed release), setuptools 84.2.1, filelock 4.2.10, and certifi in the Whisper image. Nothing else moved: `uv pip compile` kept every other pin.
- Pillow 13 is a major release. The GPU app's own image helpers (`_read_image`, `_save_image`, `_read_mask` in `gpu/modal_app.py`) were run on Pillow 13.0.0 and NumPy 2.3.5 with a rotated JPEG, RGBA and palette PNGs, a 16-bit PNG and a damaged file: every one reads, writes PNG, JPG and WebP, and the damaged one is refused as before. They use only `open`, `exif_transpose`, `convert`, `resize`, `paste`, `putalpha`, `fromarray` and `save`, none of which 13 changes.

better-auth is 1.7.20, not the newest 1.7.22: `minimumReleaseAge` holds back releases under a day old.

**Why:**
- CI's dependency audit fails on any high advisory, so every pull request had been red since 2026-11-03 and nothing could merge or deploy; production ran a Next with two critical advisories.
- An update that exists is better than an ignore. The braces ignore (`2026-10-03-braces-advisory.md`) stays, since braces still has no fixed release.

**Reverse:**
- Pillow back to 12.3.0: set it in `requirements-onnx.in` and `requirements-upscale.in` and recompile; the audit then needs its eight advisories ignored by id.
- Remove the minimatch override once ESLint asks for minimatch 11.
- Drop `vite` from the root `package.json` if vitest ever depends on it directly.
- Move Lighthouse past 13.5.0 once a release no longer pulls an FSL-licensed package, or once Astro approves FSL for a dev-only tool that never ships (then add its row to `docs/13-licenses.md`).
