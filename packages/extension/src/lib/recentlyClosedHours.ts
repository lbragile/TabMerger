import { activeLocale } from '@/lib/i18n';
import { formatClosedTime } from '@/lib/recentlyClosedDays';
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed';

/**
 * The recently-closed day view's hours ("day at a glance"): how many entries were closed in each
 * local hour of the day, the busiest hours, and the newest-first list cut into hour runs for the
 * hour markers. Pure apart from the locale used to format hour labels. Popup only.
 */

/** Hours in a local day, 00 to 23 (a DST day still has these 24 clock hours, one of them twice or not at all). */
export const HOURS_IN_DAY = 24;

/** The local clock hour (0-23) an entry was closed in: the hour on the wall clock, as the rows show it. */
export function closedHour(closedAt: number): number {
  return new Date(closedAt).getHours();
}

/**
 * How many entries were closed in each local hour (index 0-23). A window entry counts once, in
 * the hour it was closed, however many tabs it had. On a fall-back DST day both passes through the
 * repeated hour count in that one hour.
 */
export function countByHour(entries: readonly Pick<RecentlyClosedEntry, 'closedAt'>[]): number[] {
  const counts = new Array<number>(HOURS_IN_DAY).fill(0);
  for (const entry of entries) counts[closedHour(entry.closedAt)]++;
  return counts;
}

/** The hours with the most entries, earliest first (empty when the day has none). */
export function busiestHours(counts: readonly number[]): number[] {
  const max = Math.max(0, ...counts);
  if (max === 0) return [];
  return counts.flatMap((n, hour) => (n === max ? [hour] : []));
}

/** One run of consecutive entries closed in the same hour, as listed (newest first). */
export interface ClosedHourRun<T> {
  hour: number;
  entries: T[];
}

/**
 * Cuts a newest-first list into runs of entries closed in the same local hour, keeping the order.
 * Runs, not a map: on a fall-back DST day the repeated hour's two passes are listed next to each
 * other anyway (newest first), and a run never reorders entries.
 */
export function runsByHour<T extends Pick<RecentlyClosedEntry, 'closedAt'>>(entries: readonly T[]): ClosedHourRun<T>[] {
  const runs: ClosedHourRun<T>[] = [];
  for (const entry of entries) {
    const hour = closedHour(entry.closedAt);
    const last = runs[runs.length - 1];
    if (last && last.hour === hour) last.entries.push(entry);
    else runs.push({ hour, entries: [entry] });
  }
  return runs;
}

/**
 * A plain date with no DST change, so every hour 0-23 exists on it: hour labels are built from it,
 * never from the shown day (whose repeated or missing hour would format oddly).
 */
const LABEL_YEAR = 2000;

/** The start of an hour as the rows show times ("16:00" / "4:00 PM", by locale). */
export function hourLabel(hour: number, locale: string = activeLocale()): string {
  return formatClosedTime(new Date(LABEL_YEAR, 0, 1, hour).getTime(), locale);
}

/** A short axis label for an hour ("16" / "4 PM", by locale). */
export function hourAxisLabel(hour: number, locale: string = activeLocale()): string {
  const at = new Date(LABEL_YEAR, 0, 1, hour).getTime();
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(at);
  } catch {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(at);
  }
}

/** The hours the axis under the strip names. */
export const AXIS_HOURS = [0, 6, 12, 18, 23] as const;

/** Tallest bar (rem): the busiest hour. */
export const BAR_MAX_REM = 2.625;
/** Shortest bar (rem), so one entry next to a busy hour is still a visible, clickable bar. */
export const BAR_MIN_REM = 0.375;

/** A bar's height (rem) for `count` entries when the busiest hour of the day has `max`. */
export function barHeightRem(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.max(BAR_MIN_REM, Math.round((count / max) * BAR_MAX_REM * 1000) / 1000);
}
