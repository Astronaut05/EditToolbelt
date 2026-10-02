/**
 * The focus ring for a control drawn over a picture or video: the crop box,
 * text and drawn layers, blur areas, face buttons and the compare handle.
 * The media accent (overlays on media are always dark, docs/03) between two
 * dark bands, so the ring keeps 3:1 on any picture, light or dark (WCAG
 * 1.4.11, technique C40). Controls on the page keep the global --focus-ring.
 */
export const MEDIA_FOCUS =
  'outline-offset-2 focus-visible:outline-media-accent focus-visible:ring-6 focus-visible:ring-media-scrim';
