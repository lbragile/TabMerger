import { describe, it, expect } from 'vitest';
import {
  AI_CREDITS_RESET_DATE_FORMAT,
  aiAllowanceMonth,
  aiCreditsResetAt,
  AI_MONTHLY_PERIOD_MAX_DAYS,
  managedAiCreditsResetAt
} from '../utils/aiAllowanceMonth';

describe('aiCreditsResetAt', () => {
  const resetAt = (start: string | null | undefined, end: string | null | undefined, now: string) =>
    aiCreditsResetAt(start, end, new Date(now))?.toISOString() ?? null;

  it('is null with no stored period, or an unreadable one', () => {
    const now = '2026-11-01T00:00:00Z';
    expect(resetAt(null, null, now)).toBeNull();
    expect(resetAt(undefined, undefined, now)).toBeNull();
    expect(resetAt('2026-10-01T00:00:00Z', null, now)).toBeNull();
    expect(resetAt(null, '2026-12-01T00:00:00Z', now)).toBeNull();
    expect(resetAt('not a date', '2026-12-01T00:00:00Z', now)).toBeNull();
    expect(resetAt('2026-10-01T00:00:00Z', 'not a date', now)).toBeNull();
  });

  it('a monthly period resets at its end, whatever day of it the clock is on', () => {
    const [start, end] = ['2026-10-31T10:00:00Z', '2026-11-30T10:00:00Z'];
    expect(resetAt(start, end, '2026-10-31T10:00:00Z')).toBe('2026-11-30T10:00:00.000Z');
    expect(resetAt(start, end, '2026-11-30T09:59:59Z')).toBe('2026-11-30T10:00:00.000Z');
  });

  it('is null once the end has passed: the renewal is held until paid, so the date is unknown', () => {
    const [start, end] = ['2026-10-31T10:00:00Z', '2026-11-30T10:00:00Z'];
    expect(resetAt(start, end, '2026-11-30T10:00:00Z')).toBeNull();
    expect(resetAt(start, end, '2027-03-01T00:00:00Z')).toBeNull();
    expect(resetAt('2026-10-05T00:00:00Z', '2027-10-05T00:00:00Z', '2027-10-05T00:00:00Z')).toBeNull();
  });

  it('treats a period of exactly the limit as monthly and one second more as longer', () => {
    const start = '2026-10-01T00:00:00Z';
    const atLimit = new Date(Date.parse(start) + AI_MONTHLY_PERIOD_MAX_DAYS * 86_400_000).toISOString();
    const past = new Date(Date.parse(atLimit) + 1000).toISOString();
    expect(resetAt(start, atLimit, '2026-10-15T00:00:00Z')).toBe(atLimit);
    expect(resetAt(start, past, '2026-10-15T00:00:00Z')).toBe('2026-11-01T00:00:00.000Z');
  });

  it('walks a yearly period through monthly anniversaries, clamped to month ends from the start', () => {
    const [start, end] = ['2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z'];
    const next = (now: string) => resetAt(start, end, now);
    expect(next('2026-10-31T10:00:00Z')).toBe('2026-11-30T10:00:00.000Z');
    expect(next('2026-11-30T09:59:59Z')).toBe('2026-11-30T10:00:00.000Z');
    // An anniversary at the clock has happened, so the next one is a month on, back on the 31st
    expect(next('2026-11-30T10:00:00Z')).toBe('2026-12-31T10:00:00.000Z');
    expect(next('2027-01-31T10:00:00Z')).toBe('2027-02-28T10:00:00.000Z');
    expect(next('2027-02-28T10:00:00Z')).toBe('2027-03-31T10:00:00.000Z');
  });

  it('clamps to February 29 in a leap year, and counts on from the start afterwards', () => {
    const [start, end] = ['2027-10-31T10:00:00Z', '2028-10-31T10:00:00Z'];
    expect(resetAt(start, end, '2028-02-01T00:00:00Z')).toBe('2028-02-29T10:00:00.000Z');
    expect(resetAt(start, end, '2028-02-29T10:00:00Z')).toBe('2028-03-31T10:00:00.000Z');
    // A monthly period that ends on the leap day
    expect(resetAt('2028-01-31T10:00:00Z', '2028-02-29T10:00:00Z', '2028-02-10T00:00:00Z')).toBe('2028-02-29T10:00:00.000Z');
  });

  it('crosses New Year and lands on the period end for the last anniversary of a year', () => {
    const [start, end] = ['2026-10-05T00:00:00Z', '2027-10-05T00:00:00Z'];
    expect(resetAt(start, end, '2026-12-20T00:00:00Z')).toBe('2027-01-05T00:00:00.000Z');
    expect(resetAt(start, end, '2027-09-20T00:00:00Z')).toBe('2027-10-05T00:00:00.000Z');
  });

  it('is never past the end of a longer period that was cut short', () => {
    // A 45-day period (Stripe's cancel_at can shorten one): the second anniversary would be Dec 15
    const [start, end] = ['2026-10-15T00:00:00Z', '2026-11-29T00:00:00Z'];
    expect(resetAt(start, end, '2026-10-20T00:00:00Z')).toBe('2026-11-15T00:00:00.000Z');
    expect(resetAt(start, end, '2026-11-20T00:00:00Z')).toBe('2026-11-29T00:00:00.000Z');
  });

  it('gives the first anniversary when the clock is before the start', () => {
    expect(resetAt('2026-10-05T00:00:00Z', '2027-10-05T00:00:00Z', '2026-09-01T00:00:00Z')).toBe('2026-11-05T00:00:00.000Z');
  });

  it('is the moment the month key moves on', () => {
    const [start, end] = ['2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z'];
    let now = new Date('2026-11-15T00:00:00Z');
    for (let i = 0; i < 10; i++) {
      const reset = aiCreditsResetAt(start, end, now)!;
      expect(aiAllowanceMonth(start, end, new Date(reset.getTime() - 1))).toBe(aiAllowanceMonth(start, end, now));
      expect(aiAllowanceMonth(start, end, reset)).not.toBe(aiAllowanceMonth(start, end, now));
      now = reset;
    }
  });

  it('accepts the +00:00 form the database returns and reads now from the clock by default', () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000).toISOString().replace('Z', '+00:00');
    expect(aiCreditsResetAt(past, future.toISOString().replace('Z', '+00:00'))?.getTime()).toBe(future.getTime());
    expect(aiCreditsResetAt('2020-01-01T00:00:00+00:00', '2020-02-01T00:00:00+00:00')).toBeNull();
  });

  it('formats in UTC, so the date does not depend on the viewer: 23:30 UTC stays that day', () => {
    const at = new Date('2026-11-30T23:30:00Z');
    expect(at.toLocaleDateString('en-US', AI_CREDITS_RESET_DATE_FORMAT)).toBe('Nov 30, 2026');
    expect(new Intl.DateTimeFormat('de', AI_CREDITS_RESET_DATE_FORMAT).format(at)).toBe('30.11.2026');
  });
});

describe('managedAiCreditsResetAt', () => {
  const now = new Date('2026-11-15T00:00:00Z');
  const period = { ai_period_start: '2026-10-31T10:00:00Z', ai_period_end: '2026-11-30T10:00:00Z' };
  const active = { tier: 'pro_ai', status: 'active', ai_mode: 'managed', ...period };
  const reset = new Date('2026-11-30T10:00:00Z');

  it('gives the date for an active Pro AI plan on TabMerger key, also with the mode unset', () => {
    expect(managedAiCreditsResetAt(active, now)).toEqual(reset);
    expect(managedAiCreditsResetAt({ ...active, ai_mode: null }, now)).toEqual(reset);
  });

  it.each([
    ['own key', { ai_mode: 'byok' }],
    ['Pro', { tier: 'pro' }],
    ['free', { tier: 'free' }],
    ['past_due', { status: 'past_due' }],
    ['trialing', { status: 'trialing' }],
    ['canceled', { status: 'canceled' }],
    ['no stored period', { ai_period_start: null, ai_period_end: null }],
    ['a period that has ended', { ai_period_end: '2026-11-14T10:00:00Z' }]
  ])('is null for %s', (_name, change) => {
    expect(managedAiCreditsResetAt({ ...active, ...change }, now)).toBeNull();
  });

  it('is null with no row', () => {
    expect(managedAiCreditsResetAt(null, now)).toBeNull();
    expect(managedAiCreditsResetAt(undefined, now)).toBeNull();
  });

  it('reads now from the clock by default', () => {
    // `active`'s period ended in the past for any run after it, and a live one reads as live
    const end = new Date(Date.now() + 86_400_000);
    const live = { ...active, ai_period_start: new Date(Date.now() - 86_400_000).toISOString(), ai_period_end: end.toISOString() };
    expect(managedAiCreditsResetAt(live)).toEqual(end);
  });
});

describe('aiAllowanceMonth', () => {
  it('falls back to the UTC calendar month with no stored period', () => {
    const now = new Date('2026-11-01T00:30:00Z');
    expect(aiAllowanceMonth(null, null, now)).toBe('2026-11');
    expect(aiAllowanceMonth(undefined, undefined, now)).toBe('2026-11');
    expect(aiAllowanceMonth('2026-10-01T00:00:00Z', null, now)).toBe('2026-11');
    expect(aiAllowanceMonth(null, '2026-12-01T00:00:00Z', now)).toBe('2026-11');
    expect(aiAllowanceMonth('not a date', '2026-12-01T00:00:00Z', now)).toBe('2026-11');
  });

  it('gives one key to the whole of a monthly period, so Oct 31 and Nov 1 share an allowance', () => {
    const [start, end] = ['2026-10-31T10:00:00Z', '2026-11-30T10:00:00Z'];
    expect(aiAllowanceMonth(start, end, new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
    expect(aiAllowanceMonth(start, end, new Date('2026-11-01T00:00:00Z'))).toBe('2026-10');
    expect(aiAllowanceMonth(start, end, new Date('2026-11-30T09:59:59Z'))).toBe('2026-10');
  });

  it('does not move past a monthly period that has ended with no renewal written', () => {
    expect(aiAllowanceMonth('2026-10-05T00:00:00Z', '2026-11-05T00:00:00Z', new Date('2027-03-01T00:00:00Z'))).toBe('2026-10');
  });

  it('treats a period of exactly the limit as monthly and one second more as longer', () => {
    const start = '2026-10-01T00:00:00Z';
    const atLimit = new Date(Date.parse(start) + AI_MONTHLY_PERIOD_MAX_DAYS * 86_400_000).toISOString();
    const past = new Date(Date.parse(atLimit) + 1000).toISOString();
    const now = new Date('2026-11-02T00:00:00Z');
    expect(aiAllowanceMonth(start, atLimit, now)).toBe('2026-10');
    expect(aiAllowanceMonth(start, past, now)).toBe('2026-11');
  });

  it('walks a yearly period through 12 monthly keys, clamped to month ends from the start', () => {
    const [start, end] = ['2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z'];
    const key = (now: string) => aiAllowanceMonth(start, end, new Date(now));
    expect(key('2026-11-30T09:59:59Z')).toBe('2026-10');
    expect(key('2026-11-30T10:00:00Z')).toBe('2026-11');
    expect(key('2026-12-31T09:59:59Z')).toBe('2026-11');
    expect(key('2026-12-31T10:00:00Z')).toBe('2026-12');
    expect(key('2027-02-28T10:00:00Z')).toBe('2027-02');
    expect(key('2027-03-31T10:00:00Z')).toBe('2027-03');
    expect(key('2027-09-30T10:00:00Z')).toBe('2027-09');
  });

  it('caps a yearly period at its last anniversary, however late the clock is', () => {
    const [start, end] = ['2026-10-05T00:00:00Z', '2027-10-05T00:00:00Z'];
    expect(aiAllowanceMonth(start, end, new Date('2027-10-05T00:00:00Z'))).toBe('2027-09');
    expect(aiAllowanceMonth(start, end, new Date('2028-06-01T00:00:00Z'))).toBe('2027-09');
  });

  it('never goes before the start', () => {
    expect(aiAllowanceMonth('2026-10-05T00:00:00Z', '2027-10-05T00:00:00Z', new Date('2026-09-01T00:00:00Z'))).toBe('2026-10');
  });

  it('reads now from the clock by default', () => {
    expect(aiAllowanceMonth(null, null)).toBe(new Date().toISOString().slice(0, 7));
  });

  it('accepts the +00:00 form the database returns', () => {
    expect(aiAllowanceMonth('2026-10-31T10:00:00+00:00', '2026-11-30T10:00:00+00:00', new Date('2026-11-15T00:00:00Z'))).toBe('2026-10');
  });
});
