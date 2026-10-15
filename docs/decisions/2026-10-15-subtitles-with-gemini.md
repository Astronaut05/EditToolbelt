# 2026-10-15 · Subtitles with Gemini, from the browser, with the person's own key

**Decision:**
- T09 Subtitle Generator (`/subtitle-generator`, beta) makes SRT from speech with Google's Gemini API. The default model is `gemini-3.5-flash`, and the person can type another.
- The person pastes their own API key on the page. Their browser calls Gemini directly: the key goes in the `x-goog-api-key` header, and audio goes in as 16 kHz mono WAV clips. Nothing passes through our servers, and the tool is free here.
- The key is kept in `localStorage` (`etb.gemini_key`) only while they tick Remember on this device. A new `secret` option kind in the ToolShell masks it and never shows it in a summary. Option values were already never sent to analytics.
- Gemini does what code can't do well: it hears the words and groups them into cues by meaning, returned as JSON to a schema. `@etb/core` then checks the reply rather than trusting it:
  - it repairs word times;
  - it splits any cue over the style's limit, at punctuation, then pauses, then the middle;
  - it snaps cue edges next to a pause onto where the voice starts or stops, read from the audio's levels;
  - it closes pauses under the setting (1.5 s by default) and removes overlaps.
- A recording over 110 s goes in clips of about 75 s, cut in its longest pauses, so times can't drift and one answer stays well under the output limit.
- `https://generativelanguage.googleapis.com` joins `connect-src` on every page, on both builds, from `@etb/core/third-party`. `scripts/check-hosts.ts` lists it as fixed by its provider.
- The registry gets `sendsTo: 'Google Gemini'`. That makes the privacy badge, the "Why use this" lines and the Open Graph status say where the audio goes, instead of "never leaves your device".

**Why:**
- Astro asked for accurate Uzbek subtitles now, with Gemini, which handles Uzbek better than the open models a browser can run.
- V17 Auto Subtitles and A12 Transcribe Audio (Whisper on our GPUs) wait on Modal. A key of Astro's own costs us nothing and needs no server path, credits or upload.
- **Every page, not only the tool's:** a client-side navigation keeps the CSP of the page it started on. Allowing Gemini only on `/subtitle-generator` would break the tool whenever it's reached from search, a hub or a related link. Making those links full page loads (as `ISOLATED_PATHS` does) would also drop the in-memory handoff.
- **What that costs:** pages can now reach one more host. That host is Google's API, which needs a key to do anything, and the CSP still allows scripts only from us.
- **Splitting, by layer:** splitting text into cues by rule works badly for meaning, which is Astro's point. Leaving everything to the model gives cues that are sometimes too long, overlapping or drifting. So the model decides meaning and code enforces the limits.
- **Field fallback:** structured-output field names are moving (`responseJsonSchema`, `responseFormat`). The client sends the schema with a low thinking level. On a 400 naming a field, it drops that field and tries again, down to plain JSON mode, and keeps the downgrade for the rest of the run.

**Reverse:**
- Remove `subtitle-generator` from the registry, `tools/README.md` and the views.
- Remove `@etb/core/third-party` from both CSP builders and the host from `scripts/check-hosts.ts`.
- Once V17 runs on Modal, its Whisper path can take over, with Gemini kept as an option or dropped.
- To move the key off the page, add a server proxy holding our own key and charge credits per minute like A12. The page would then say "Processed on our servers".
