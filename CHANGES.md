# Review changes — 2026-09-29

Fixes applied to the spec, each with the evidence behind it. Decisions that are yours to make are listed at the bottom and tracked in `docs/14-open-questions.md` (#15–17).

## Contradictions inside the spec (fixed)

1. **Account deletion broke the append-only ledger.** `04` said deletion "anonymises their ledger (`user_id` set to a tombstone id)", which is an UPDATE on `credit_transactions`, and the trigger forbids that. **Fix:** the user row is scrubbed into a tombstone (email, name and locale nulled; `email` made nullable). The ledger is never touched. → `04`
2. **Deleting old jobs broke the ledger's foreign key.** `credit_transactions.job_id` was an FK to `jobs`, but jobs older than 90 days get deleted, and the ledger can't be updated to null the reference. **Fix:** `job_id` becomes a plain indexed uuid with no FK. → `04`
3. **"Disabled tools stay visible"** (CLAUDE.md rule 8) contradicted the status table, where `disabled` means hidden. The rule is really about `soon` tools. **Fix:** renamed it to "Coming-soon tools stay visible". → `CLAUDE.md`
4. **`disabled` page said "404 → redirect".** Those are two different responses. **Fix:** a real 404 with links to the hub and related tools. → `02`
5. **Wave 1 had 3 hybrid tools (P07, V02, V03) but no server until M4/M5.** **Fix:** added a `server_enabled` flag. The server offer, and any price for it, only appear once that path exists. → `02`, `04`, `12`
6. **P08 promised a "face-friendly" model** while its controls listed General / Anime. **Fix:** kept General + Anime. Face models need a licence check first. → `photo.md`, `13`

## Claims that were wrong about the outside world (fixed)

7. **The "24 h hard ceiling" on files isn't what R2 delivers.** R2 lifecycle rules work in whole days, and objects are removed *typically within 24 h after* they expire. The real worst case is ~48 h. R2 also keeps incomplete multipart uploads for **7 days** by default. **Fix:** the sweeper is the guarantee, lifecycle (1-day expire + 1-day multipart abort) is the backstop, the Privacy text says 1 h / 48 h backstop, and the alert fires on anything older than 2 h instead of 25 h. → `CLAUDE.md`, `01`, `07`, `08`, `11`, `12` · [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
8. **CSP nonces would have killed the speed plan.** The Next.js docs say nonces require dynamic rendering: static generation and ISR are disabled, and pages can't be CDN-cached. That breaks `10`'s static-from-the-edge, LCP ≤ 1.8 s budget. **Fix:** public pages stay static with hash-based CSP (SRI, experimental), nonces only on already-dynamic routes, and M1 has to prove it works. → `11`, `12` · [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy)
9. **The credit pricing formula ignored VAT and Paddle's fee.** Paddle charges 5% + $0.50 per transaction, and prices include VAT. At the placeholder prices a credit nets ≈ 1.5¢ on the studio pack, not the 3.0¢ the formula used. Every tool's real margin would have been about half of what admin showed. **Fix:** a new `credit_net_usd` formula, computed in config, with free usage tracked as its own cost line. → `05`
10. **R2 multipart needs equal-size parts,** except the last (min 5 MiB), and part URLs expire in 15 min. **Fix:** one part size per upload, plus `POST /uploads/:id/parts` to fetch URLs in batches. → `01`, `06` · [R2 multipart](https://developers.cloudflare.com/r2/objects/multipart-objects/)
11. **MP3 and AAC encoding.** WebCodecs has no MP3 encoder, and some browsers can't encode AAC. **Fix:** feature-detect, with Mediabunny's AAC/MP3 encoder extensions as lazy-loaded fallbacks (LGPL inside, handled like the other LGPL modules). → `audio.md`, `video.md`, `13` · [Mediabunny codecs](https://mediabunny.dev/guide/supported-formats-and-codecs), [AAC encoder](https://mediabunny.dev/guide/extensions/aac-encoder)

## Gaps closed

12. **Soft navigation doesn't give cross-origin isolation.** `crossOriginIsolated` is set when a document loads, so a `next/link` click into an ffmpeg route leaves it without `SharedArrayBuffer`. **Fix:** full page loads into and out of COOP/COEP routes, plus a Playwright test. → `01`, `12`
13. **SSE through Cloudflare** drops connections that are silent for 100 s. **Fix:** a ping every 20 s. → `01`
14. ~~**IPv6 quota bypass**~~. Superseded by decision 1 below: anonymous users no longer get server jobs, so the IP hash is gone.
15. **Welcome-grant farming** by deleting the account and signing up again. **Fix:** a keyed-hash claim table kept 12 months, added to the Privacy table. → `04`, `08`
16. **Time-stretch.** Signalsmith Stretch (MIT, has a WASM/AudioWorklet build) replaces LGPL SoundTouch as the first choice. → `audio.md`, `13` · [signalsmith-stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch)
17. **Paddle onboarding** includes a website review. Start the application at M2 launch, not M5. → `12`
18. **JS budget.** Measure the empty shell against 120 KB in M1, before tool code exists. → `12`

## Checked and confirmed (no change needed)

- **Paddle** doesn't list Uzbekistan as an unsupported country. → [Paddle supported countries](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle)
- **Premiere UXP** moved from beta to a standard release in Premiere 2026. Added "minimum host = Premiere 2026". → [Hyper Brew](https://hyperbrew.co/blog/uxp-plugins-in-premiere-2026/)
- **Uzbekistan's personal-data amendments** (in force on publication, late March 2026) allow storage abroad under adequacy or approved clauses. Biometric, genetic and telecom data must stay local. The spec's description holds, and the lawyer items stay. → [Daryo](https://daryo.uz/en/2026/03/29/uzbekistan-amends-personal-data-law-for-domestic-storage-and-regulated-foreign-processing/)
- **Tool list integrity:** 75 tools, wave counts 26 / 32 / 17, and README codes match the category files exactly.

## Design source: `/design-taste-frontend` (added)

19. **Design source.** The spec never mentioned the skill. It is now the design source (`CLAUDE.md`, `03`):
    - Its design round sets the M1 look: 2–3 directions for the home page and a tool page, desktop and phone, light and dark.
    - It makes the marketing graphics: OG images and demo-video covers.
    - Its taste rules are restated for UI in `03`, because Claude Code can't load a claude.ai skill: dials per page type, one locked accent, no AI glows, a banned-filler list, no em dashes in UI copy, and an AI-tells review list.
20. **Font: Inter → Onest + IBM Plex Mono.** The skill bans Inter as a default. Onest was checked with fontTools:
    - variable 100–900
    - has tabular figures, which the spec requires
    - covers Uzbek ʻ and қ ғ ҳ ў

    Commissioner has no `tnum`, so it was ruled out. → `03`, `10`, `13`
21. **TT Hoves banned for EditToolbelt.** The skill forces it for Uzcosmos work, but it's a commercial font licensed to Uzcosmos, and embedding it in a website distributes it. → `13`, `CLAUDE.md`
22. **Font subsetting kept Uzbek oʻ / gʻ out.** A plain Latin + Cyrillic subset drops U+02BB, so the ʻ would fall back to another font. It is now in the subset. → `10`

## Round 1 decisions (2026-09-29)

1. **Server jobs require sign-in.** Anonymous visitors get every browser tool, but no server jobs. This removed `anon_key`, the IP hashing, anonymous quotas and the `anon` limit tier, and the app now stores no IPs at all. → `01`, `02`, `04`, `05`, `06`, `07`, `08`, `12`
2. **Minimum pack is $5.** Placeholder packs are now $5 / $15 / $40 for 200 / 700 / 2,000 credits. Worst-case net per credit is ≈ 1.54¢. → `05`
3. **Smaller first launch.** M2 ships a 15-tool launch set on 6 engines. The other 11 Wave 1 tools, ffmpeg.wasm, mediainfo and smart-cut trim move to a new **M2b**. Only 17 conversion pair pages go live at launch. → `12`, `tools/README.md` (Launch set table), `video.md`
4. **Premiere panel moves up.** It is now **M7**, right after the API. Remaining Wave 2 + mobile polish is now M8. → `12`, `CLAUDE.md`, `14`

## Round 2 decisions (2026-09-29)

5. **Renamed to EditToolbelt.** "EditBench" is already a Google Research image-editing benchmark and an ICML code-editing benchmark. No collisions were found for EditToolbelt, and edittoolbelt.com doesn't resolve. Changes everywhere:
    - product name and tagline ("the editor's toolbelt")
    - domain list
    - API key prefix, now `etb_live_` / `etb_test_`
    - Premiere bin name
    - folder name
6. **Free hosting until the project is finished.** The plan by phase:
    - Code lives on GitHub.
    - The public static site runs on **Cloudflare Pages**, free, deployed from GitHub.
    - Server staging for M3–M4 runs on your PC via a **Cloudflare Tunnel**.
    - Paid EU hosting starts at M5.

    GitHub Pages was rejected because its terms ban running an online business or SaaS on it, and it can't set headers. Buy the domain now so SEO survives the later move. Cloudflare Pages has a 25 MiB per-file limit, so the models are served from R2. → `01`, `12`, `14` · [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
7. **Background-removal models verified.** BiRefNet is MIT for both code and weights, but its lite ONNX build is 115 MB even at fp16, which breaks the 50 MB browser budget. Added BEN2 base (MIT) as a server candidate and flagged InSPyReNet's weights licence as unconfirmed. → `13`, `14` · [BiRefNet](https://github.com/ZhengPeng7/BiRefNet), [BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX), [BEN2](https://huggingface.co/PramaLLC/BEN2)

## Round 3 decisions (2026-09-29)

8. **Browser AI model budget is now 120 MB.** P07 defaults to BiRefNet_lite fp16 (115 MB) on WebGPU. Devices without WebGPU fp16 get a small **light-mode** model. If an int8 build keeps quality, it replaces fp16. → `10`, `photo.md`, `12`, `13`, `14`
9. **The GTX 1080 Ti runs the GPU tools in local staging** through a new dev-only `LocalGpu` backend, so GPU tools get built and tested in M4, not M5. Pascal rules, from the verified support changes:
    - Pin PyTorch to a build with `sm_61`, because PyTorch dropped Pascal from its CUDA 12.8+ wheels.
    - Stay on NVIDIA driver 580, the last branch that supports Pascal.
    - Run models in fp32, not fp16.
    - Use a separate dev-only image and never price from its speed.

    → `01`, `12` · [PyTorch: Maxwell/Pascal removed from CUDA 12.8+ builds](https://dev-discuss.pytorch.org/t/cuda-toolkit-version-and-architecture-support-update-maxwell-and-pascal-architecture-support-removed-in-cuda-12-8-and-12-9-builds/3128), [Phoronix: 580 is the last driver for Pascal](https://www.phoronix.com/news/NVIDIA-580-Linux-Driver-Last-HW)

## Still open

Open questions #1–11, #13 and #14 in `docs/14-open-questions.md`. Most need a lawyer, an accountant, or real data.
