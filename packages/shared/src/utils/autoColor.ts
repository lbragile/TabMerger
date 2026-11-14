import { AUTO_ITEM_COLORS } from '../constants/index';

/**
 * A random colour from `AUTO_ITEM_COLORS` that is never `previous` (the colour of the item made
 * just before, so two in a row always differ). `random` is a test seam returning [0, 1).
 */
export function pickAutoColor(previous?: string, random: () => number = Math.random): string {
  const choices = AUTO_ITEM_COLORS.filter((c) => c !== previous);
  const r = random();
  const i = Math.min(choices.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * choices.length)));
  return choices[i];
}

const DAY_MS = 86_400_000;

/**
 * The colour of a local calendar day (`YYYY-MM-DD`): the number of days from 1970-01-01 to that
 * date, modulo the colour count. Counted on the calendar date itself (not on a timestamp), so a
 * day always gets the same colour whatever the time zone or a DST change, and two consecutive days
 * always differ. An unreadable key gets the first colour.
 */
export function colorForDay(localDayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDayKey);
  if (!m) return AUTO_ITEM_COLORS[0];
  const days = Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
  const n = AUTO_ITEM_COLORS.length;
  return AUTO_ITEM_COLORS[((days % n) + n) % n];
}
