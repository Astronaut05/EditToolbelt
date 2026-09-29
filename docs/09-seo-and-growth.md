# 09 — SEO and growth

Search is the main channel: people type "remove background from image", "mp4 to gif", "find bpm of song" and land on a tool page. Every tool page is built to be the best result for its phrase: the tool works instantly, above the fold, with no signup.

## URL scheme

- Tool pages are **flat and short**: `/remove-background`, `/mp4-to-gif`, `/bpm-key-finder`. Slug = registry `slug`.
- Category hubs: `/photo`, `/video`, `/audio`, `/color`, `/subtitles-time`, `/utility`.
- Conversion pairs (programmatic): `/convert/heic-to-jpg`, `/convert/mov-to-mp4`, `/convert/wav-to-mp3` — generated from a whitelist of **real, supported** format pairs in `packages/registry/conversions.ts`. Each pair page is the converter tool preset with that input/output, plus unique copy (what the formats are, when you'd convert, quality notes). Only pairs with real search demand get a page — start with ~30, not every combination.
- Legal/utility pages: `/privacy`, `/terms`, `/refunds`, `/licenses`, `/contact`, `/developers`.
- Trailing slash: none. Lowercase only. Old slugs → 301 via `redirects.ts`.

## Page template (from registry)

- `<title>`: `{seo.title}` — search phrase first, brand last: "Remove Background from Image, Free in Your Browser | EditToolbelt". ≤ 60 chars where possible.
- Meta description from `seo.description`.
- H1 = `seo.h1`. One H1 per page.
- Tool workspace **immediately** under the H1. Page must be usable before any below-the-fold content loads.
- Below the tool: How-to (3–5 steps), "Why use this" (3 short points: speed, privacy, free/no signup — true per tool), FAQ (real questions and specific answers), related tools, category link.
- Structured data (JSON-LD): `WebApplication` (name, applicationCategory `MultimediaApplication`, operatingSystem "Any (web browser)", `offers` price 0 for free tools), `BreadcrumbList`, and `FAQPage` where the FAQ is on the page.
- Open Graph + Twitter card image per tool, generated at build from a template (tool icon + name) designed with `/design-taste-frontend` with `@vercel/og`-style rendering or a build script.
- Canonical URL on every page. Conversion pair pages canonicalise to themselves (they're distinct intents), not to the base converter.

## Quality rules (to avoid thin/scaled-content penalties)

- No page exists that doesn't have a working tool on it. `soon` placeholders are `noindex` and excluded from the sitemap.
- Copy is written per tool. No spun text, no keyword stuffing, no near-duplicate pages. If two tools would say the same thing, they should probably be one tool.
- FAQs answer questions users actually ask (use search suggestions, Reddit threads, and "People also ask" as sources — human-reviewed).
- Numbers in copy must be true for our tool (limits, formats, speeds).

## Technical SEO

- Server-rendered HTML for all content (Next.js Server Components); the tool's interactive part hydrates after.
- `sitemap.xml` generated from the registry (live + beta tools, hubs, conversion pairs, legal pages) with `lastmod`.
- `robots.txt` allows all except `/admin`, `/api`, `/account`.
- Core Web Vitals budgets in `10-performance.md`; monitor with Search Console + real-user metrics.
- Internal linking: every tool links to 3–6 related tools and its hub; hubs link to all their tools; home links to hubs and top tools.
- Images: descriptive alt text; example images are ours or license-free.
- `hreflang` ready for later languages; English at root for now.

## Languages (later)

Architecture is i18n-ready from day one (next-intl, all UI strings in message files). First additions after English: **Russian** (large editor audience across the region) and **Uzbek**. Localised pages at `/ru/...`, `/uz/...` with fully translated SEO fields (not machine-dumped — reviewed).

## Measuring

- Google Search Console + Bing Webmaster Tools from launch day.
- Cookieless analytics (self-hosted Umami or similar): page views, referrers, and these custom events — all without personal data:

| Event | Props |
|---|---|
| `tool_file_added` | tool_id, mime family, size bucket |
| `tool_run_started` | tool_id, path (client/server) |
| `tool_run_succeeded` | tool_id, engine path, duration bucket |
| `tool_run_failed` | tool_id, error_code, engine path |
| `tool_download` | tool_id |
| `tool_handoff` | from_tool, to_tool |
| `server_fallback_offered` / `_accepted` | tool_id, reason |
| `credits_quote_shown` / `credits_quote_accepted` | tool_id, credits bucket |
| `checkout_started` / `checkout_completed` | pack_id |
| `signup_completed` | source page category |

Weekly look: which tools get traffic, which convert to runs, which fail most, which pages rank where.

## Growth beyond search (low-effort, repeatable)

1. **Reddit, done properly.** Participate in editor communities (video editing, Premiere, audio production, photography) by answering questions; link a tool only when it directly solves the question; follow each subreddit's self-promotion rules. Reddit threads increasingly rank in Google and get cited in AI answers, so good answers keep paying off.
2. **Short demo videos.** 15–30 s screen recordings: "Remove background in 3 seconds, no signup". Post to YouTube Shorts, TikTok, Instagram Reels. Covers made with `/design-taste-frontend` (EditToolbelt look, no Uzcosmos logo). This is the channel where a video editor has an unfair advantage.
3. **Directories and launches.** List on AlternativeTo (as an alternative to the big single-purpose sites), free-tool directories, AI tool directories for the AI tools; a Product Hunt launch once 20+ tools are live.
4. **Answer-engine friendly.** Clear, factual first paragraph on each page answering the query directly — AI search tools quote pages that answer cleanly.
5. **Premiere panel listing** later on Adobe Exchange — its own discovery channel.

AI can draft posts, video scripts, FAQ copy and directory submissions; a human (you) approves everything before it goes out.
