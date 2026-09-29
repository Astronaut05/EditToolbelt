/** "4.8 MB": KB/MB/GB with one decimal (docs/03 → Copy rules). Decimal units, like OS file managers. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'TB'}`;
}

/** "00:01:12.400" (hours always shown, milliseconds). */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

/** `holiday.jpg` + `nobg` + `png` → `holiday_nobg.png` (docs/02 → output naming). */
export function outputName(inputName: string, suffix: string, ext: string): string {
  const dot = inputName.lastIndexOf('.');
  const stem = dot > 0 ? inputName.slice(0, dot) : inputName;
  return `${stem || 'file'}_${suffix}.${ext}`;
}

/** Does a file match an `accept` string ("image/*,.heic")? */
export function matchesAccept(file: { name: string; type: string }, accept: string): boolean {
  if (!accept.trim()) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) =>
      rule.startsWith('.')
        ? name.endsWith(rule)
        : rule.endsWith('/*')
          ? type.startsWith(rule.slice(0, -1))
          : type === rule,
    );
}
