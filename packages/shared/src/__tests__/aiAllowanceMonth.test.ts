import { describe, it, expect } from 'vitest';
import { aiAllowanceMonth, AI_MONTHLY_PERIOD_MAX_DAYS } from '../utils/aiAllowanceMonth';

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
