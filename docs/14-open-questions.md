# 14 — Open questions

Decisions not made yet. Claude Code: when a milestone depends on one of these, **stop and ask** instead of choosing. Each has a sensible default so work isn't blocked earlier than necessary.

| # | Question | Needed by | Default if not decided |
|---|---|---|---|
| 1 | **Domain, logo, accent colour.** Name decided: **EditToolbelt** (renamed from Editbench on 2026-09-29: "EditBench" is already a Google Research image-editing benchmark and an ICML code-editing benchmark). Pick domain from edittoolbelt.com / .app / .io (whichever is free) when going public | M1 sign-off (tokens), Go public (domain) | Wordmark "EditToolbelt" in the UI font, grey-blue accent |
| 2 | Final credit pack sizes and prices | M5 | Placeholders in `05` |
| 3 | Free allowance numbers (signed-in daily jobs, welcome grant) | M4/M5 | Placeholders in `05` |
| 4 | Serverless GPU provider (EU region, per-second billing, custom containers, DPA, no input retention) | M5 | — must decide |
| 5 | Paid hosting provider for web/worker/DB | M5 | Hetzner (EU) + Cloudflare + R2. **Until Go public (decided 2026-09-29, M0 sign-off):** everything runs locally on your PC (dev stack + production build served locally); code and CI on GitHub; no Cloudflare, no domain. At Go public: Cloudflare Pages (free) for the static site and R2 for model files (see `12` → Go public) |
| 6 | Transactional email provider (magic links, receipts) | M3 | Any EU-capable provider with DPA |
| 7 | Launch languages beyond English (Russian? Uzbek?) | M8 | English only; i18n-ready |
| 8 | Business form in Uzbekistan for Paddle payouts, tax treatment (sole proprietor vs IT Park resident) | Before M5 live payments | — accountant/lawyer |
| 9 | EU/UK representative requirement; Uzbekistan operator registration | Before M5 | — lawyer (see `08`) |
| 10 | Codec patent exposure: HEIC/HEVC decode in browser (libde265), H.264/AAC encoding on server | Before M2 launch | Rely on WebCodecs (OS/browser-licensed codecs) in browser; ask lawyer about libheif and server encoders; if in doubt, HEIC decode goes server-side or uses the browser's native decoder where available |
| 11 | Background-removal models. Browser: benchmark BiRefNet_lite (115 MB fp16, or an int8 build if quality holds) vs ISNet vs u2netp on quality, size and phone speed. Server: BiRefNet general/HR vs BEN2 base. All MIT/Apache (see `13`) | M2 | **Budget decided 2026-09-29: ≤ 120 MB.** Default BiRefNet_lite fp16; light-mode model and int8 swap decided by the M2 benchmark |
| 12 | ~~Whether anonymous users get any server jobs~~ | — | **Decided 2026-09-29:** sign-in required for all server jobs |
| 13 | Premiere panel distribution: free with credits, or also sold? | M7 | Free panel, uses credits |
| 14 | Keep a Telegram bot front-end for the Uzbek audience (the original idea) as a later surface on the same API? | After M6 | Not now; the API makes it cheap later |
| 15 | ~~Smallest pack price~~ | — | **Decided 2026-09-29:** $5 minimum; placeholder packs $5 / $15 / $40 |
| 16 | ~~Launch scope~~ | — | **Decided 2026-09-29:** 15-tool launch set in M2, rest of Wave 1 in M2b |
| 17 | ~~Premiere panel timing~~ | — | **Decided 2026-09-29:** panel is M7, right after the API; remaining Wave 2 + mobile is M8 |
| 18 | ~~Local S3 server now that MinIO is out~~ | — | **Decided 2026-09-29 (M0 sign-off):** Versity S3 Gateway (Apache-2.0). It has no bucket lifecycle rules, which only matter in production: the lifecycle check runs against R2 later, and locally the retention sweeper is the only cleanup path, which is what we test. Switch to SeaweedFS only if Versity blocks something we need |
| 19 | Moving to Node 26 (next LTS). **Node 25+ no longer ships Corepack**, so `corepack enable` in `apps/web/Dockerfile.dev` fails (exit 127, seen on Dependabot's Node 26 PR) and the README's `corepack enable` step stops working. Before the move: install pnpm another way in the image and locally (e.g. `npm install -g pnpm@<version from packageManager>`), then bump `.nvmrc`, the `node` image, `@types/node`, and lift the Dependabot ignore rules for those majors | When Astro decides | **Decided 2026-09-29:** stay on Node 24 LTS until Astro says otherwise |
