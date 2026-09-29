/**
 * Joins a base (an absolute URL or a root-relative path) and a path, with
 * exactly one slash between them. Used with SITE_URL and MODELS_BASE_URL so no
 * code ever spells out a host.
 */
export function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = path.replace(/^\/+/, '');
  if (trimmedPath === '') return `${trimmedBase}/`;
  return `${trimmedBase}/${trimmedPath}`;
}
