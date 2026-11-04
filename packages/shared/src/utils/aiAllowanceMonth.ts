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

import { isAiMode } from '../constants/ai';

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

/**
 * How a reset date is written, in the viewer's locale: UTC, the zone the month key is computed in,
 * so the server's render and the browser's agree and the web app and the extension show one date.
 */
export const AI_CREDITS_RESET_DATE_FORMAT = { dateStyle: 'medium', timeZone: 'UTC' } as const satisfies Intl.DateTimeFormatOptions;

/**
 * The instant the next allowance month starts, the moment {@link aiAllowanceMonth} moves on (once
 * paid): a monthly period's end, or a longer period's next anniversary of the start, never past
 * its end. Null when there's no stored period, or its end has passed: the next period is stored
 * once its renewal is paid, so the date isn't known, and it must not be guessed. For display only.
 */
export function aiCreditsResetAt(periodStart: PeriodBound, periodEnd: PeriodBound, now: Date = new Date()): Date | null {
  const period = parsePeriod(periodStart, periodEnd);
  if (!period || period.end.getTime() <= now.getTime()) return null;

  const { start, end } = period;
  if (end.getTime() - start.getTime() <= AI_MONTHLY_PERIOD_MAX_DAYS * DAY_MS) return end;

  // An anniversary exactly at `now` has already happened, as in aiAllowanceMonth()
  const months = Math.max(1, monthsBetween(start, now));
  const candidate = anniversary(start, months);
  const next = candidate > now.getTime() ? candidate : anniversary(start, months + 1);
  return new Date(Math.min(next, end.getTime()));
}

/** The columns of a `subscriptions` row that say whether, and when, its credits reset. */
export interface AiCreditsResetRow {
  tier?: unknown;
  status?: unknown;
  ai_mode?: unknown;
  ai_period_start?: string | null;
  ai_period_end?: string | null;
  /** Stripe's flag, stored by the webhook: the plan ends when the current period does. */
  cancel_at_period_end?: boolean | null;
}

/**
 * {@link aiCreditsResetAt} of a subscription whose monthly credits reset: an `active` Pro AI plan
 * on TabMerger's key (`ai_mode` managed, or unset). Null for any other row: an own key has no
 * credits, a free plan has none to reset, and a plan that isn't `active` is waiting on a payment.
 */
export function managedAiCreditsResetAt(row: AiCreditsResetRow | null | undefined, now: Date = new Date()): Date | null {
  if (row?.tier !== 'pro_ai' || row.status !== 'active') return null;
  if (isAiMode(row.ai_mode) && row.ai_mode !== 'managed') return null;
  return aiCreditsResetAt(row.ai_period_start, row.ai_period_end, now);
}

/** A moment as an ISO string or a Date, in ms; null when missing or unreadable. */
function instant(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** What is known about the plan after the credits date, beyond the `subscriptions` row. */
export interface AiCreditsNextPeriod {
  /**
   * Stripe's `cancel_at` (not stored on the row; only a caller that read Stripe has it). The row's
   * `cancel_at_period_end` already covers a `cancel_at` at or before the period end: the webhook
   * stores it as true then.
   */
  cancelAt?: Date | string | null;
  /**
   * A plan change scheduled for later (read from Stripe on the web server; not on the row): when it
   * takes effect, and the plan it moves to. `tier` null: a price this deployment doesn't sell.
   */
  scheduledChange?: { effectiveAt: Date | string; tier: 'free' | 'pro' | 'pro_ai' | null; aiMode?: unknown } | null;
}

/** The date next to a managed balance: `reset` brings a fresh allowance, `end` doesn't. */
export interface AiCreditsDate {
  at: Date;
  kind: 'reset' | 'end';
}

/**
 * {@link managedAiCreditsResetAt}, and whether the credits reset then or end. They end when the
 * next period is known not to be a managed Pro AI plan (TabMerger's key): the subscription is set
 * to cancel when the period ends (`cancel_at_period_end`, and the date is the period's end), Stripe's
 * `cancel_at` is at or before the date, or a change scheduled at or before the date moves to Pro,
 * Free, an own key or a price this deployment doesn't sell. A change that stays on managed Pro AI
 * (yearly to monthly) still resets, and so do a yearly plan's anniversaries before a cancellation
 * or a change. For display only; null when {@link managedAiCreditsResetAt} is.
 */
export function managedAiCreditsDate(
  row: AiCreditsResetRow | null | undefined,
  next: AiCreditsNextPeriod = {},
  now: Date = new Date()
): AiCreditsDate | null {
  const at = managedAiCreditsResetAt(row, now);
  if (!at) return null;
  const when = at.getTime();
  const periodEnd = instant(row?.ai_period_end);
  const cancelAt = instant(next.cancelAt);
  const change = next.scheduledChange;
  const changeAt = instant(change?.effectiveAt);
  const staysManaged = change?.tier === 'pro_ai' && (!isAiMode(change.aiMode) || change.aiMode === 'managed');
  const ends =
    (row?.cancel_at_period_end === true && periodEnd !== null && when >= periodEnd) ||
    (cancelAt !== null && cancelAt <= when) ||
    (changeAt !== null && changeAt <= when && !staysManaged);
  return { at, kind: ends ? 'end' : 'reset' };
}
