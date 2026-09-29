import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TIERS } from '@/lib/tiers'

describe('TIERS.pro.features', () => {
  it('starts with "Everything in Free"', () => {
    expect(TIERS.pro.features[0]).toBe('Everything in Free')
  })
})

describe('getStripePriceId / getPriceInfo', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_pro_monthly'
    process.env.STRIPE_PRO_YEARLY_PRICE_ID = 'price_pro_yearly'
    process.env.STRIPE_PRO_AI_MONTHLY_PRICE_ID = 'price_proai_monthly'
    process.env.STRIPE_PRO_AI_YEARLY_PRICE_ID = 'price_proai_yearly'
  })

  it('returns the monthly/yearly price id for a tier', async () => {
    const { getStripePriceId } = await import('@/lib/tiers')
    expect(getStripePriceId('pro', 'monthly')).toBe('price_pro_monthly')
    expect(getStripePriceId('pro', 'yearly')).toBe('price_pro_yearly')
    expect(getStripePriceId('proAi', 'monthly')).toBe('price_proai_monthly')
    expect(getStripePriceId('proAi', 'yearly')).toBe('price_proai_yearly')
  })

  it('resolves a known pro monthly price id to its display cost', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo('price_pro_monthly')).toEqual({ amount: 3.99, interval: 'monthly' })
  })

  it('resolves a known pro AI yearly price id to its display cost', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo('price_proai_yearly')).toEqual({ amount: 85.99, interval: 'yearly' })
  })

  it('returns null for an unknown/legacy price id', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo('price_discontinued')).toBeNull()
  })

  it('returns null for null/undefined input', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo(null)).toBeNull()
    expect(getPriceInfo(undefined)).toBeNull()
  })
})

describe('yearlySavings', () => {
  it('gives the per-month equivalent and the saving against twelve monthly payments', async () => {
    const { yearlySavings } = await import('@/lib/tiers')
    const { perMonth, percent } = yearlySavings(3.99, 42.99)
    expect(perMonth).toBeCloseTo(3.5825)
    expect(percent).toBe(10) // 10.21%, rounded down
  })

  it('rounds the percentage down so it never overstates the discount', async () => {
    const { yearlySavings } = await import('@/lib/tiers')
    expect(yearlySavings(10, 101).percent).toBe(15) // 15.83%
  })

  it('is 0% when there is no discount or no monthly price', async () => {
    const { yearlySavings } = await import('@/lib/tiers')
    expect(yearlySavings(5, 60).percent).toBe(0)
    expect(yearlySavings(0, 0).percent).toBe(0)
  })
})

describe('formatUsd', () => {
  it('always shows cents', async () => {
    const { formatUsd } = await import('@/lib/tiers')
    expect(formatUsd(3.5825)).toBe('$3.58')
    expect(formatUsd(7)).toBe('$7.00')
  })
})
