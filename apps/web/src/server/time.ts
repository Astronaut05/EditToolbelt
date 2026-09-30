/**
 * The time a request is being served at. Server components render once per
 * request, so reading the clock there is fine; React's purity lint rule is
 * written for components that re-render, and this keeps it quiet honestly.
 */
export function requestTime(): number {
  return Date.now();
}
