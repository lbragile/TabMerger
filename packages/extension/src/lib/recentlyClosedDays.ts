import { RECENTLY_CLOSED_LIMITS, colorForDay } from '@tabmerger/shared';
import { activeLocale, t } from '@/lib/i18n';
import { localDayKey, type RecentlyClosedEntry } from '@/lib/recentlyClosed';

/**
 * The recently-closed list grouped into local days, for the sidebar's day rows and the day view.
 * Popup only (it reads the catalog, so the worker must never import it, see locales/worker.ts).
 */

/** One day of the recently-closed list. */
export interface RecentlyClosedDay {
  /** Stable id of the local calendar day, `YYYY-MM-DD` (the `mainView.day` value). */
  key: string;
  /** `today`, `yesterday`, or an older day shown by its date. */
  kind: 'today' | 'yesterday' | 'date';
  /** "Today", "Yesterday", or "Wed, Nov 11" in `locale` (the year is added for another year). */
  label: string;
  /**
   * The day's colour (`rgba(...)` from `AUTO_ITEM_COLORS`, see `colorForDay`): always the same for
   * a day, and never the same for two consecutive days.
   */
  color: string;
  /** Local midnight that starts the day (epoch ms). */
  start: number;
  /** Local midnight that ends it (the next day's start; a DST day is 23 or 25 hours). */
  end: number;
  /** The day's entries, newest first. */
  entries: RecentlyClosedEntry[];
  /** Tab entries (closed one at a time). */
  tabCount: number;
  /** Window entries. */
  windowCount: number;
  /** Every tab, the ones inside window entries included. */
  allTabCount: number;
}

// One definition with the pruning (worker-safe module): day rows and Free's rolling window agree.
export { localDayKey };

/** Local midnight starting the day of `ms`, and the next one (built from the calendar date, so DST days come out right). */
export function localDayBounds(ms: number): { start: number; end: number } {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return { start, end };
}

/**
 * The label of a day: "Today" / "Yesterday" from the catalog, else weekday + date in `locale`
 * (with the year when it isn't `now`'s year).
 */
export function dayLabel(start: number, now: number, locale: string = activeLocale()): { kind: RecentlyClosedDay['kind']; label: string } {
  const today = new Date(now);
  const key = localDayKey(start);
  if (key === localDayKey(now)) return { kind: 'today', label: t('recentlyClosed.day.today') };
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
  if (key === localDayKey(yesterday)) return { kind: 'yesterday', label: t('recentlyClosed.day.yesterday') };
  const sameYear = new Date(start).getFullYear() === today.getFullYear();
  let label: string;
  try {
    label = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(start);
  } catch {
    label = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(start);
  }
  return { kind: 'date', label };
}

/**
 * Groups entries into local days, newest day first, each day's entries newest first. Cleared
 * entries are left out. Days are split at LOCAL midnight (`now`'s time zone), so a tab closed at
 * 23:59:59 belongs to that day and one closed at 00:00:00 to the next. Pure apart from reading the
 * catalog for "Today" / "Yesterday".
 */
export function groupEntriesByDay(entries: readonly RecentlyClosedEntry[], now: number, locale: string = activeLocale()): RecentlyClosedDay[] {
  const byKey = new Map<string, RecentlyClosedDay>();
  const sorted = entries.filter((e) => e.clearedAt === undefined).sort((a, b) => b.closedAt - a.closedAt);
  for (const entry of sorted) {
    const key = localDayKey(entry.closedAt);
    let day = byKey.get(key);
    if (!day) {
      const { start, end } = localDayBounds(entry.closedAt);
      const { kind, label } = dayLabel(start, now, locale);
      day = { key, kind, label, color: colorForDay(key), start, end, entries: [], tabCount: 0, windowCount: 0, allTabCount: 0 };
      byKey.set(key, day);
    }
    day.entries.push(entry);
    if (entry.kind === 'window') day.windowCount++;
    else day.tabCount++;
    day.allTabCount += entry.tabs.length;
  }
  return [...byKey.values()].sort((a, b) => b.start - a.start);
}

/** The clock time an entry was closed at ("14:58" / "2:58 PM", by locale). */
export function formatClosedTime(closedAt: number, locale: string = activeLocale()): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(closedAt);
  } catch {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(closedAt);
  }
}

/** How many days a plan keeps: Free's rolling `recentDays` (the newest days with closes), Pro's calendar `days`. */
export function recentlyClosedKeptDays(plan: 'free' | 'pro'): number {
  return plan === 'free' ? RECENTLY_CLOSED_LIMITS.free.recentDays : RECENTLY_CLOSED_LIMITS.pro.days;
}

/**
 * How long each plan keeps the list, from `RECENTLY_CLOSED_LIMITS` (never literal numbers): "Free
 * keeps your last 2 days. Pro keeps your last 30 days." The entry counts are storage caps only and
 * are never shown. The quiet line on Free under the sidebar section and the oldest day.
 */
export function recentlyClosedPlanNote(): string {
  const freeLine = t('recentlyClosed.section.freeKeeps', { count: recentlyClosedKeptDays('free') });
  const proLine = t('recentlyClosed.section.proKeeps', { count: recentlyClosedKeptDays('pro') });
  return `${freeLine} ${proLine}`;
}

/** Settings → Data's line for the plan's own window: "Your plan keeps your last 2 days" (30 on Pro). */
export function recentlyClosedKeepsLine(plan: 'free' | 'pro'): string {
  return t('recentlyClosed.settings.keeps', { count: recentlyClosedKeptDays(plan) });
}

/** The empty section's text, with the plan's window ("…, for your last 2 days."). */
export function recentlyClosedEmptyText(plan: 'free' | 'pro'): string {
  return t('recentlyClosed.section.empty', { count: recentlyClosedKeptDays(plan) });
}
