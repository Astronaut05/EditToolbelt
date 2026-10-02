# 02 — Tool framework

How a tool is defined, rendered, routed and tested. Every tool follows this; no exceptions.

## The idea

A tool = **registry entry** (data) + **engine** (shared processing code) + **preset** (tool-specific options and defaults). Many SEO pages share one engine: "crop image", "resize image", "rotate image" are presets of the image-geometry engine; "MP4 to GIF" and "video to GIF" are the same tool with different default input.

Adding a tool after the shell exists should mean: one registry entry, one preset file, maybe one processor, tests. If a new tool needs a new layout, the shell is missing a feature — add it to the shell, not the tool.

## Registry entry

`packages/registry/src/tools/<category>/<tool-id>.ts`, validated by a Zod schema at build time.

```ts
export type ToolDef = {
  id: string;                    // stable, e.g. "remove-background" — never changes once live
  code: string;                  // spec code from tools/README.md, e.g. "P08"
  slug: string;                  // URL path segment, e.g. "remove-background"
  category: 'photo' | 'video' | 'audio' | 'color' | 'subtitles-time' | 'utility';
  name: string;                  // "Remove Background"
  tagline: string;               // one line under the H1
  summary: string;               // ≤ 48 chars: hub rows, "Until then, try" rows
  status: 'live' | 'beta' | 'soon' | 'disabled';   // default; admin can override at runtime
  wave: 1 | 2 | 3;
  runtime: 'client' | 'server-cpu' | 'server-gpu' | 'hybrid';
  engines: EngineId[];          // see engines table; hybrid tools list the client and the server engine
  ui: 'canvas-editor' | 'timeline' | 'form' | 'analyzer' | 'calculator' | 'batch';
  accepts?: string[];            // MIME types / extensions (required once live or beta)
  outputs?: string[];            // required once live or beta
  batch: boolean;                // can take multiple files at once
  limits?: {                     // per tier; server tools only use the server limits (required once live or beta)
    client?: { maxBytes: number; maxPixels?: number; maxDurationSec?: number };
    server?: Record<'free' | 'paid', { maxBytes: number; maxDurationSec?: number; maxPixels?: number }>;
    maxConcurrent?: number; timeoutSec?: number;
  };
  cost: CreditRule;              // { kind: 'free' } | { kind: 'flat', credits } | { kind: 'perMinute', credits, min } | { kind: 'perMegapixel', ... }
  surfaces: ('web' | 'mobile' | 'panel' | 'api')[];
  desktopBest?: boolean;
  crossOriginIsolated?: boolean; // needs COOP/COEP (multi-threaded ffmpeg.wasm); links into it are full page loads
  seo: {
    title: string;               // <title>, ≤ 60 chars, starts with the search phrase
    description: string;         // ≤ 155 chars
    h1: string;                  // = primary search phrase, natural wording
    primaryQuery: string;        // e.g. "remove background from image"
    secondaryQueries: string[];
    howTo?: string[];            // 3–5 short steps shown under the tool (required once live or beta)
    faq?: { q: string; a: string }[];  // 3–6, unique per tool, real answers (required once live or beta)
  };
  related: string[];             // tool ids, 3–6
  willDo: string[];              // 2–4 lines: "what it will do" on the coming-soon page
  presets?: Preset[];            // named option sets, e.g. "Instagram Story 1080×1920"
};
```

Rules:
- `id` and `slug` are kebab-case, unique, and never renamed after `live` (a rename needs a 301 redirect entry in `packages/registry/redirects.ts`).
- `status` in code is the default. `tool_flags` in the DB overrides it at runtime (see `07-admin-and-logging.md`). Resolution order: DB flag → code default.
- `soon` tools must still have `name`, `slug`, `category`, `tagline`, `summary`, `willDo` and `seo.title` so the greyed-out card and placeholder page render. `live` and `beta` tools also need `accepts`, `outputs`, `limits`, `seo.howTo` and `seo.faq` (the schema enforces it). Calculators (`ui: 'calculator'`) take no files, so for them only `seo.howTo` and `seo.faq` are required.
- The schema (`packages/registry/src/schema.ts`) is checked in tests, not at runtime, so Zod never ships to the browser. Copy fields reject em and en dashes (`03` → Copy rules).
- A CI check fails if any registry entry is missing from `tools/README.md` or vice versa (match on `code`).

## Engines

Shared processing implementations. Tools choose one and pass options.

| Engine id | Runs | Used by (examples) |
|---|---|---|
| `image-geometry` | client, OffscreenCanvas | crop, resize, rotate/flip, social resizer, split grid, collage |
| `image-codec` | client, jSquash / libheif WASM | convert, compress, HEIC, strip metadata on re-encode |
| `image-paint` | client, canvas layers | draw, text, watermark, blur/pixelate regions |
| `image-color` | client, WebGL / canvas sampling | palette, colour picker, LUT preview, gradients |
| `image-vector` | client, vtracer WASM | image to SVG |
| `image-ml` | client onnxruntime-web (WebGPU/WASM), server fallback | remove background, face blur detection |
| `image-ml-server` | server-gpu | upscale, object eraser, hi-res background removal |
| `video-webcodecs` | client, Mediabunny | trim, convert, compress, resize/crop, to GIF frames, extract frames, mute, rotate, speed |
| `video-ffmpeg-wasm` | client, ffmpeg.wasm LGPL | remux, formats WebCodecs can't handle, GIF palette |
| `video-ffmpeg-server` | server-cpu | large files, VFR→CFR, burn subtitles, merge mixed specs |
| `video-ml-server` | server-gpu | auto subtitles (via audio), video upscale, video background removal |
| `audio-dsp` | client, TS DSP in worker | convert (via encoders), trim, fade, normalize, loudness, BPM/key, silence, channels |
| `audio-ml-server` | server-gpu / cpu | stems, noise reduction, transcription |
| `media-probe` | client, mediainfo.js; server ffprobe | video info / VFR check, EXIF viewer |
| `file-hash` | client, hash-wasm in a worker, streamed | file checksums (MD5, SHA-1, SHA-256) |
| `text` | client, `packages/core` | subtitle convert/shift, calculators, QR, color math |

Engines live in `packages/engines/<engine-id>/` and expose a worker-friendly API:

```ts
interface Engine<Opts, Out> {
  capabilities(caps: Capabilities): { supported: boolean; reason?: string };
  estimate(input: InputMeta, opts: Opts): { seconds: number; outputBytes?: number };
  run(input: File | Blob, opts: Opts, ctx: { progress(p: number, stage?: string): void; signal: AbortSignal }): Promise<Out>;
}
```

Every `run` must honour `signal` (cancel button) and report progress at least every 500 ms for jobs longer than 2 s.

## Routing (`route()`)

For `hybrid` tools the preset exports:

```ts
route(input: InputMeta, caps: Capabilities, user: UserTier): 'client' | { server: true; reason: string; credits: number }
```

Defaults: client if capabilities OK and within `limits.client`; otherwise server with a human reason. The UI shows the reason and price and asks before sending anything to the server. **Never upload a file the user didn't explicitly agree to upload.**

**Server path not live yet.** Three Wave 1 tools are `hybrid` (P07, V02, V03) but launch in M2, before any server path exists (M4/M5). Until a tool's server path is switched on (`tool_flags.server_enabled`, default `false`), `route()` never offers the server: an over-limit file gets the specific limit error plus a one-line "Larger files: coming soon". The UI must never show a price or an upload offer for a path that doesn't exist yet.

## The ToolShell

`packages/ui/ToolShell` renders every tool page from its registry entry:

1. Breadcrumb (Home › Category › Tool) + H1 + tagline + privacy badge ("Runs in your browser — files never leave your device" for client runtime; "Processed on our servers, deleted within 1 hour" for server).
2. **Workspace** — the part that changes per `ui` type:
   - `form`: drop zone → options panel → result panel.
   - `canvas-editor`: shared photo editor (see `03-design-system.md`) opened on drop, in the mode the preset sets.
   - `timeline`: shared media timeline (waveform/thumbnail strip, in/out handles, playhead, zoom) for trim/cut/fade/subtitles.
   - `analyzer`: drop zone → results readout (BPM/key, loudness, media info) + actions.
   - `calculator`: inputs ↔ outputs, live, no files.
   - `batch`: file list with per-file status, shared options, "download all as ZIP".
3. **Result panel** — preview, before/after where it makes sense, output size, download button, "Use in another tool →" (hands the output to a related tool without re-upload, via an in-memory handoff), "Start over".
4. How-to steps (from `seo.howTo`), FAQ (from `seo.faq`), related tools (from `related`), links to the category hub.

Shared behaviours the shell owns (tools never re-implement):
- Drop zone, file picker, paste from clipboard, drag from another tab; Android share target intake.
- Input validation against `accepts` and limits, with specific errors ("This is a 4.1 GB file; the browser limit for this tool is 2 GB").
- Progress bar with stage label, elapsed time, cancel.
- Credit price display and confirmation for paid runs; sign-in prompt when needed.
- Output naming: `<original-stem>_<tool-suffix>.<ext>` (e.g. `holiday_nobg.png`). The original name is used locally only; never sent to the server — server uploads are keyed by random ids and the result's download name is set client-side.
- Error states with a retry and a plain explanation; failed paid jobs say "Credits returned".
- Keyboard: `Ctrl/Cmd+O` open, `Ctrl/Cmd+S` download result, `Esc` cancel.
- Analytics events (see `09-seo-and-growth.md`).

## Status behaviour

| Status | Hub card | Tool page | Sitemap | API `/tools` |
|---|---|---|---|---|
| `live` | normal | full | yes | yes |
| `beta` | normal + "Beta" tag | full + beta note | yes | yes |
| `soon` | greyed, "Coming soon", not clickable to a tool | placeholder: name, tagline, what it will do, links to related live tools; `noindex` | no | listed with `status` |
| `disabled` | hidden | real 404 status (not a redirect — Google treats redirect-to-hub as a soft 404 anyway) with a page naming the tool as retired and linking the category hub and related tools. For temporary outages admin uses `beta` + maintenance message instead | no | hidden |

Admin can also set a per-tool **maintenance message** shown above the workspace without changing status.

## Tests per tool

- Unit tests for preset logic and any pure functions (`packages/core`, engine option builders).
- One Playwright test per tool: open page, drop fixture, run with default options, assert output exists and matches expectations (dimensions, duration ±50 ms, format, loudness ±0.5 LU, etc.).
- Server processors: pytest with fixtures, including one malformed file that must fail cleanly.
- Accessibility: axe check in the Playwright run for each tool page (no serious violations).

## Adding a tool — checklist

1. Row exists in `tools/README.md` and a spec block in the category file.
2. Check any new dependency/model in `docs/13-licenses.md`.
3. Registry entry with complete `seo` (unique copy, not templated filler).
4. Preset + (if server) processor with `estimate` and `run`.
5. Tests as above.
6. Set status `beta` first; flip to `live` after a day without errors in admin.
