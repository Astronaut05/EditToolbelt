/** "1:30:00", "90:00", "95" (seconds) or "1h 30m" → seconds; null if unreadable. */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const units =
    /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec)?)?$/.exec(
      text,
    );
  if (units && (units[1] ?? units[2] ?? units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  }
  const parts = text.split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** 5400 → "1:30:00", 95.5 → "1:35.5". Rounds to tenths first, so 3599.996 is "1:00:00". */
export function formatDuration(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const h = Math.floor(tenths / 36_000);
  const m = Math.floor((tenths % 36_000) / 600);
  const s = (tenths % 600) / 10;
  const ss = String(s).padStart(s < 10 ? (Number.isInteger(s) ? 2 : 4) : 0, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}
