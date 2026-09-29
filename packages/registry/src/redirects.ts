/**
 * Permanent redirects for renamed slugs (docs/02 → Registry entry rules).
 *
 * A live tool's id and slug never change; if a slug ever must, add a row here
 * and the build writes it into `_redirects` as a 301. Nothing has been public
 * yet, so the list is empty.
 */
export interface Redirect {
  from: string;
  to: string;
}

export const redirects: readonly Redirect[] = [];
