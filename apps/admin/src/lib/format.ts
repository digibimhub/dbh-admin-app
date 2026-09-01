/**
 * Date rules from the spec:
 *  - Timestamps show relative ("3 days ago") with the absolute value on hover.
 *  - Licence dates are ALWAYS absolute with an explicit timezone note, because
 *    `licenses.start_date` / `end_date` are DATE columns, not timestamps —
 *    running them through `new Date()` in a negative-offset browser would shift
 *    them a day.
 */

export const LICENSE_TZ_NOTE =
  'Licence dates are calendar dates (UTC), not timestamps — no local-time conversion is applied.';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Render a DATE column (`YYYY-MM-DD`) verbatim — never via the Date constructor. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1] ?? mo;
  return `${Number(d)} ${month} ${y}`;
}

/** Whole days from today (UTC) until a `YYYY-MM-DD` date. Negative when past. */
export function daysUntil(dateOnly: string | null | undefined): number | null {
  if (!dateOnly) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/** Add whole months to a `YYYY-MM-DD` date, clamping to the end of the month. */
export function addMonths(dateOnly: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly);
  if (!m) return dateOnly;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const target = new Date(Date.UTC(y, mo + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Full absolute timestamp with the viewer's timezone spelled out. */
export function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date} ${time} (${tz})`;
}

const UNITS: [limit: number, divisor: number, name: string][] = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86_400, 3600, 'hour'],
  [2_592_000, 86_400, 'day'],
  [31_536_000, 2_592_000, 'month'],
  [Infinity, 31_536_000, 'year'],
];

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const seconds = (Date.now() - d.getTime()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  for (const [limit, divisor, name] of UNITS) {
    if (abs < limit) {
      const n = Math.round(abs / divisor);
      const plural = n === 1 ? '' : 's';
      return seconds >= 0 ? `${n} ${name}${plural} ago` : `in ${n} ${name}${plural}`;
    }
  }
  return d.toISOString().slice(0, 10);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-GB');
}

export function formatDelta(n: number, suffix = ''): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n)}${suffix}`;
}

export function pct(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

/** "LAPTOP-JS" from a device, falling back to a short hash so a row is never blank. */
export function shortHash(hash: string, length = 12): string {
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`;
}
