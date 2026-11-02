/**
 * The month key of `ai_usage` and `ai_credit_purchases`: the row a user's managed AI credits are
 * counted in right now. It stays a 'YYYY-MM' text, but it is no longer the calendar month: credits
 * reset when a paid billing period starts, so the key is the UTC calendar month in which the
 * current allowance month STARTED. Migration 030's `ai_allowance_month()` is the same rule in SQL;
 * `supabase/tests/030_ai_billing_period_credits.test.sql` holds the case table both are checked
 * against (the pgTAP file for SQL, `packages/web/__tests__/aiAllowanceMonthSqlDrift.test.ts` here).
 *
 * - A monthly period (at most {@link AI_MONTHLY_PERIOD_MAX_DAYS} days): the month of its start,
 *   whatever the clock says. Stripe keeps one period start per calendar month (anchor 31: Jan 31,
 *   Feb 28, Mar 31), so each paid period has its own key. A period that has ended with no renewal
 *   written yet keeps its key: the next period is stored once its renewal is paid (the web app's
 *   findUnpaidRenewal()), and there is no fresh bucket before that.
 * - A longer period (yearly): the allowance still resets monthly, because the Price pays for 12
 *   monthly allowances. The key is the month of the latest monthly anniversary of the start that
 *   has passed and lies before the period's end. Anniversaries clamp to the month's end the way
 *   Stripe's do and are counted from the start, never from each other (Oct 31 -> Nov 30 -> Dec 31).
 * - No stored period (own key, free, a row not yet re-synced): the UTC calendar month.
 *
 * The server is the authority: the AI routes compute the key from the row they read, and a client
 * never supplies it. The extension uses this for its display only.
 */

/** Longest period that counts as one allowance month. Stripe's monthly periods are at most 31 days. */
export const AI_MONTHLY_PERIOD_MAX_DAYS = 32;

const DAY_MS = 86_400_000;

/** A stored period bound: an ISO string from the database, or nothing. */
type PeriodBound = string | null | undefined;

/** 'YYYY-MM' of a year and a month index that may run past 11 (a yearly period crossing New Year). */
const monthKey = (year: number, monthIndex: number): string =>
  `${String(year + Math.floor(monthIndex / 12)).padStart(4, '0')}-${String((monthIndex % 12) + 1).padStart(2, '0')}`;

const calendarMonth = (at: Date): string => monthKey(at.getUTCFullYear(), at.getUTCMonth());

const monthsBetween = (from: Date, to: Date): number =>
  (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());

/** `start` plus `months`, clamped to the end of the month it lands in, as Stripe and Postgres do. */
function anniversary(start: Date, months: number): number {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(
    year,
    month,
    Math.min(start.getUTCDate(), lastDay),
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds()
  );
}

/** The largest anniversary number whose date passes `allowed`, starting from the months between. */
function latestAnniversary(start: Date, limit: Date, allowed: (at: number) => boolean): number {
  const months = monthsBetween(start, limit);
  return allowed(anniversary(start, months)) ? months : months - 1;
}

/** Both bounds as dates, or null when either is missing or unreadable (the calendar-month case). */
function parsePeriod(periodStart: PeriodBound, periodEnd: PeriodBound): { start: Date; end: Date } | null {
  if (!periodStart || !periodEnd) return null;
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? null : { start, end };
}

/** The month key of a subscription's AI credits at `now`. See the module comment for the rules. */
export function aiAllowanceMonth(periodStart: PeriodBound, periodEnd: PeriodBound, now: Date = new Date()): string {
  const period = parsePeriod(periodStart, periodEnd);
  if (!period) return calendarMonth(now);

  const { start, end } = period;
  if (end.getTime() - start.getTime() <= AI_MONTHLY_PERIOD_MAX_DAYS * DAY_MS) return calendarMonth(start);

  const passed = latestAnniversary(start, now, (at) => at <= now.getTime());
  const beforeEnd = latestAnniversary(start, end, (at) => at < end.getTime());
  return monthKey(start.getUTCFullYear(), start.getUTCMonth() + Math.max(0, Math.min(passed, beforeEnd)));
}
