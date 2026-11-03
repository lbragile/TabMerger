/**
 * Tests for lib/subscriptionEnd.ts: when a Stripe subscription counts as set to end with its
 * current period (the stored `subscriptions.cancel_at_period_end`).
 */
import { describe, it, expect } from 'vitest'
import { isSetToEndAtPeriodEnd } from '@/lib/subscriptionEnd'

const PERIOD_END = 1_800_000_000
const subscription = (fields: { cancel_at?: number | null; cancel_at_period_end?: boolean }, periodEnd: number | null = PERIOD_END) => ({
  cancel_at: fields.cancel_at ?? null,
  cancel_at_period_end: fields.cancel_at_period_end ?? false,
  items: { data: periodEnd === null ? [{}] : [{ current_period_end: periodEnd }] },
})

describe('isSetToEndAtPeriodEnd', () => {
  it("is true for Stripe's cancel_at_period_end", () => {
    expect(isSetToEndAtPeriodEnd(subscription({ cancel_at_period_end: true, cancel_at: PERIOD_END }))).toBe(true)
  })

  it('is true for a cancel_at at the period end with the flag false (the portal on flexible billing mode)', () => {
    expect(isSetToEndAtPeriodEnd(subscription({ cancel_at: PERIOD_END }))).toBe(true)
  })

  it('is true for a cancel_at before the period end', () => {
    expect(isSetToEndAtPeriodEnd(subscription({ cancel_at: PERIOD_END - 60 }))).toBe(true)
  })

  it('is false for a cancel_at after the period end: the plan renews at least once', () => {
    expect(isSetToEndAtPeriodEnd(subscription({ cancel_at: PERIOD_END + 1 }))).toBe(false)
  })

  it('is false with neither', () => {
    expect(isSetToEndAtPeriodEnd(subscription({}))).toBe(false)
  })

  it('reads a cancel_at with no period end to compare as set to end', () => {
    expect(isSetToEndAtPeriodEnd(subscription({ cancel_at: PERIOD_END }, null))).toBe(true)
    expect(isSetToEndAtPeriodEnd({ cancel_at: PERIOD_END, cancel_at_period_end: false, items: null } as never)).toBe(true)
  })
})
