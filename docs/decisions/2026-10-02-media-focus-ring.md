# 2026-10-02 · Focus rings on pictures: the media accent between two dark bands

**Decision:** controls drawn over a picture or video (the crop box, text and drawn layers, blur areas, face buttons, the before/after handle) show focus as a 2 px `--media-accent` ring with a 2 px offset, inside a 6 px band of `--media-scrim` (`MEDIA_FOCUS` in `packages/ui/src/tool/media-focus.ts`). Controls on the page keep the global `--focus-ring`.

**Why:** WCAG 1.4.11 asks 3:1 for a focus indicator against what is next to it. On a light photo under the crop box's dimming, the global ring was 1.73:1 (rgb(75, 112, 0) against rgb(140, 140, 140)). `--media-accent` alone would only reach 2.2:1 there, and less on brighter pictures. Between dark bands it is 10.6:1 on every picture, and the dark band is 4.8:1 against that dimmed photo and more against brighter ones (WCAG technique C40, a two-colour indicator). Measured on the static build with a light test image on /crop-image.
**Reverse:** remove `MEDIA_FOCUS` from those components (and `outline-offset-4` back on the crop box and text layer); the global ring applies again.
